/**
 * harness.ts — C1/D1 健康分与 Python harness 桥（仅桌面端）
 *
 * 启用条件：非移动端且运行时能探测到 Node（process.versions.node）。
 * child_process 用动态 require 引入，import 层面不引用 Node 内置模块，移动端无感。
 * spawn `{pythonPath} 90_系统/harness/generate_health_report.py`（cwd = vault 根），
 * 解析生成的 health_report.md 各章节"错误/警告"计数 → core systemHealth 算分。
 */

import { App, Component, FileSystemAdapter, MarkdownRenderer, Modal, Notice, Platform, TFile } from 'obsidian';
import { systemHealth } from '../core/metrics';
import type { KosSettings } from '../settings';

/** 报告路径（vault 内相对，generate_health_report.py 固定输出到这里） */
const REPORT_PATH = '90_系统/harness/reports/health_report.md';

/** 桥是否可用：桌面端 + Node 运行时；不满足时命令不注册（02 文档 3.5 节） */
export function isHarnessAvailable(): boolean {
  if (Platform.isMobile) return false;
  return typeof process !== 'undefined' && typeof process.versions?.node === 'string';
}

// ---------------------------------------------------------------------------
// 报告解析
// ---------------------------------------------------------------------------

export interface HealthIssue {
  /** 一级检查章节名（如"路径检查"） */
  section: string;
  level: 'error' | 'warning';
  text: string;
}

export interface HealthReportParse {
  errors: number;
  warnings: number;
  issues: HealthIssue[];
}

/**
 * 解析 health_report.md：一级章节（## 路径检查 等）下的 `## 错误`/`## 警告`
 * 子段的列表条目计数；`无` 与普通段落不计。结构识别失败返回 null（降级只显示原文）。
 */
export function parseHealthReport(md: string): HealthReportParse | null {
  const issues: HealthIssue[] = [];
  let section = '';
  let level: 'error' | 'warning' | 'info' | null = null;
  let sawLevel = false;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      const t = h2[1].trim();
      if (t === '错误') {
        level = 'error';
        sawLevel = true;
      } else if (t === '警告') {
        level = 'warning';
        sawLevel = true;
      } else if (t === '信息') {
        level = 'info';
      } else {
        section = t;
        level = null;
      }
      continue;
    }
    if (line.startsWith('#')) continue; // 子报告大标题（# xxx报告）
    if (level !== 'error' && level !== 'warning') continue;
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item && item[1] !== '无') {
      issues.push({ section, level, text: item[1] });
    }
  }
  if (!sawLevel) return null;
  return {
    errors: issues.filter((i) => i.level === 'error').length,
    warnings: issues.filter((i) => i.level === 'warning').length,
    issues,
  };
}

// ---------------------------------------------------------------------------
// 展示 Modal
// ---------------------------------------------------------------------------

/** 扣分项文本里的第一个 `路径`（点击跳转问题文件；M12） */
function issuePath(text: string): string | null {
  const m = /`([^`]+\.md)`/.exec(text);
  return m ? m[1] : null;
}

class HealthModal extends Modal {
  /** MarkdownRenderer 需要 Component（本版 API 中 Modal 不再继承 Component），单独持有一个 */
  private readonly mdComp = new Component();

  constructor(
    app: App,
    private readonly md: string,
    private readonly parsed: HealthReportParse | null,
  ) {
    super(app);
  }

  onOpen(): void {
    this.mdComp.load();
    const { contentEl } = this;
    contentEl.addClass('kos-modal', 'kos-health-modal');

    if (this.parsed === null) {
      contentEl.createEl('h3', { text: '系统健康检查' });
      contentEl.createEl('p', { cls: 'kos-muted', text: '报告解析失败，仅显示原始输出。' });
    } else {
      const health = systemHealth({ errors: this.parsed.errors, warnings: this.parsed.warnings });
      const head = contentEl.createDiv({ cls: 'kos-stat-row' });
      head.createDiv({ cls: 'kos-big-number', text: String(health.score) });
      head
        .createDiv({ cls: 'kos-stat-meta' })
        .createDiv({
          cls: 'kos-muted',
          text: `系统健康分（M12）　错误 ${health.errors}（-5/个） · 警告 ${health.warnings}（-2/个）`,
        });

      if (this.parsed.issues.length === 0) {
        contentEl.createDiv({ cls: 'kos-empty', text: '无扣分项，全部检查通过 🎉' });
      } else {
        const list = contentEl.createDiv({ cls: 'kos-health-issues' });
        list.createEl('h4', { text: '扣分项' });
        for (const issue of this.parsed.issues) {
          const row = list.createDiv({ cls: 'kos-health-issue' });
          row.createSpan({
            cls: `kos-tag ${issue.level === 'error' ? 'kos-health-error' : 'kos-health-warning'}`,
            text: issue.level === 'error' ? '错误' : '警告',
          });
          row.createSpan({ cls: 'kos-muted', text: issue.section });
          const path = issuePath(issue.text);
          if (path && this.app.vault.getAbstractFileByPath(path) instanceof TFile) {
            const link = row.createEl('a', { cls: 'kos-health-link', text: issue.text });
            link.addEventListener('click', () => {
              const f = this.app.vault.getAbstractFileByPath(path);
              if (f instanceof TFile) {
                this.close();
                void this.app.workspace.getLeaf('tab').openFile(f);
              }
            });
          } else {
            row.createSpan({ text: issue.text });
          }
        }
      }
    }

    // 原始报告（折叠，markdown 渲染）
    const details = contentEl.createEl('details', { cls: 'kos-health-raw' });
    details.createEl('summary', { text: '原始报告' });
    void MarkdownRenderer.render(this.app, this.md, details, '', this.mdComp);

    const row = contentEl.createDiv({ cls: 'kos-modal-buttons' });
    const close = row.createEl('button', { text: '关闭' });
    close.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.mdComp.unload();
    this.contentEl.empty();
  }
}

// ---------------------------------------------------------------------------
// spawn 运行
// ---------------------------------------------------------------------------

/** health-check 命令入口：跑 harness 健康报告并展示 */
export function runHealthCheck(app: App, settings: KosSettings): void {
  if (!isHarnessAvailable()) {
    new Notice('健康检查仅桌面端可用');
    return;
  }
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) {
    new Notice('无法确定 vault 根目录（非文件系统后端）');
    return;
  }
  const root = adapter.getBasePath();

  // 动态 require：import 层面不碰 Node 内置模块，移动端不炸
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawn } = require('child_process') as typeof import('child_process');

  new Notice('正在运行健康检查…');
  let child;
  try {
    child = spawn(settings.pythonPath, ['90_系统/harness/generate_health_report.py'], { cwd: root });
  } catch (e) {
    new Notice(`Python 启动失败：${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  let output = '';
  child.stdout?.on('data', (d: Buffer) => (output += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (output += d.toString()));
  child.on('error', (err: Error) => {
    new Notice(`Python 启动失败（${settings.pythonPath}）：${err.message}`);
  });
  child.on('close', () => {
    // 有 error 项时脚本 exit 1，属正常结果；只要报告文件生成就展示
    void app.vault.adapter
      .read(REPORT_PATH)
      .then((md) => new HealthModal(app, md, parseHealthReport(md)).open())
      .catch(() => {
        const tail = output.trim().split('\n').slice(-3).join('\n');
        new Notice(`健康报告生成失败${tail ? `：${tail}` : ''}`);
      });
  });
}
