/**
 * transition.ts — B4 状态流转写入
 *
 * 写入边界（02 文档 3.4 节）：只通过 fileManager.processFrontMatter 改状态字段
 * （summary 的流转目标 'true'/'false' 映射回 reviewed 布尔），不触碰正文与
 * `<!-- 人手动添加 -->` 块。
 *
 * 两个额外写入（状态流转的簿记，非正文）：
 * - task 流转到 done 时写 completed = 今天（否则 M4/M5/task-100 徽章永远不动）；
 * - frontmatter 已有 updated 字段时同步更新（M10 停滞判定依赖该字段）。
 */

import { App, Modal, Notice, TFile, setIcon } from 'obsidian';
import type { MarkdownPostProcessor } from 'obsidian';
import { currentState, legalTransitions, canTransition } from '../core/transitions';
import type { TransitionTarget } from '../core/transitions';
import type { KosObject } from '../core/model';
import { parseKosObject } from '../core/parse';
import type { KosSettings } from '../settings';
import { TYPE_LABELS, objectTitle } from '../views/view-context';

export type TransitionOperation = (path: string, target: string) => Promise<boolean>;

/** 流转确认对话框：展示规范依据（TransitionRule.note），返回用户是否确认 */
class TransitionConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly obj: KosObject,
    private readonly target: TransitionTarget,
    private readonly resolve: (ok: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('kos-modal');
    contentEl.createEl('h3', { text: '确认状态流转' });
    contentEl.createEl('p', {
      text: `${TYPE_LABELS[this.obj.type]}「${objectTitle(this.obj)}」：${currentState(this.obj) ?? '?'} → ${this.target.to}`,
    });
    if (this.target.note) {
      contentEl.createEl('p', { cls: 'kos-muted', text: `规范依据：${this.target.note}` });
    }
    const row = contentEl.createDiv({ cls: 'kos-modal-buttons' });
    const ok = row.createEl('button', { cls: 'mod-cta', text: '确认流转' });
    ok.addEventListener('click', () => {
      this.resolved = true;
      this.resolve(true);
      this.close();
    });
    const cancel = row.createEl('button', { text: '取消' });
    cancel.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolve(false);
  }
}

/** 弹确认框（规范要求人确认的流转）；用户确认才 resolve true */
export function confirmTransition(app: App, obj: KosObject, target: TransitionTarget): Promise<boolean> {
  return new Promise((resolve) => {
    new TransitionConfirmModal(app, obj, target, resolve).open();
  });
}

/**
 * 应用一次状态流转：合法性校验 → （必要时）确认框 → processFrontMatter 写入。
 * 返回是否实际写入。
 */
export async function applyTransition(
  app: App,
  obj: KosObject,
  target: string,
  settings: KosSettings,
  operation: TransitionOperation,
): Promise<boolean> {
  if (!canTransition(obj, target)) {
    new Notice(`非法流转：${TYPE_LABELS[obj.type]}「${objectTitle(obj)}」不能转到 ${target}`);
    return false;
  }
  const rule = legalTransitions(obj).find((t) => t.to === target);
  if (rule?.requiresConfirmation && settings.reviewConfirmDialog) {
    const ok = await confirmTransition(app, obj, rule);
    if (!ok) return false;
  }

  return operation(obj.filePath, target);
}

/** 状态选择 Modal（命令 transition-current-file 用） */
class TransitionPickerModal extends Modal {
  constructor(
    app: App,
    private readonly obj: KosObject,
    private readonly settings: KosSettings,
    private readonly operation: TransitionOperation,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('kos-modal');
    contentEl.createEl('h3', { text: `流转：${objectTitle(this.obj)}` });
    contentEl.createEl('p', {
      cls: 'kos-muted',
      text: `${TYPE_LABELS[this.obj.type]} · 当前状态 ${currentState(this.obj) ?? '—'}`,
    });
    const targets = legalTransitions(this.obj);
    if (targets.length === 0) {
      contentEl.createEl('p', { text: '当前状态没有可用的流转（终态或冻结态）。' });
      return;
    }
    const list = contentEl.createDiv({ cls: 'kos-transition-list' });
    for (const t of targets) {
      const btn = list.createEl('button', {
        cls: 'kos-transition-btn',
        text: `→ ${t.to}${t.requiresConfirmation ? '（需确认）' : ''}`,
      });
      if (t.note) btn.title = t.note;
      btn.addEventListener('click', () => {
        this.close();
        void applyTransition(this.app, this.obj, t.to, this.settings, this.operation).catch((error) =>
          new Notice(error instanceof Error ? error.message : String(error)),
        );
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** 命令入口：对当前文件弹状态选择 Modal */
export function openTransitionModal(app: App, settings: KosSettings, operation: TransitionOperation): void {
  const file = app.workspace.getActiveFile();
  if (!(file instanceof TFile)) {
    new Notice('当前没有打开的文件');
    return;
  }
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  const obj = fm ? parseKosObject(fm, file.path) : null;
  if (!obj) {
    new Notice('当前文件不是 kos 对象（缺少可识别的 type frontmatter）');
    return;
  }
  if (currentState(obj) === null) {
    new Notice(`${TYPE_LABELS[obj.type]}没有状态机，不支持流转`);
    return;
  }
  new TransitionPickerModal(app, obj, settings, operation).open();
}

/**
 * 阅读模式状态徽章：对 kos 对象笔记顶部注入状态条
 * （类型中文名 + 当前状态 + 下一状态按钮组，按钮走 applyTransition）。
 * 只改渲染 DOM，绝不触碰笔记内容与 `<!-- 人手动添加 -->` 块。
 */
export function statusBadgeProcessor(
  app: App,
  getSettings: () => KosSettings,
  operation: TransitionOperation,
  openAgent?: (path: string) => void,
): MarkdownPostProcessor {
  return (el, ctx) => {
    const fm = ctx.frontmatter;
    if (!fm) return;
    const obj = parseKosObject(fm, ctx.sourcePath);
    if (!obj) return;
    const state = currentState(obj);
    if (state === null) return; // diary/signal/dashboard 无状态机

    // 只注入一次：同一预览里已有徽章则跳过（postprocessor 按 section 调用）
    const preview = el.closest('.markdown-preview-view');
    if (!preview || preview.querySelector('.kos-status-banner')) return;

    const banner = document.createElement('div');
    banner.className = 'kos-status-banner';
    banner.createSpan({ cls: 'kos-tag', text: TYPE_LABELS[obj.type] });
    banner.createSpan({ cls: 'kos-status-banner-state', text: `状态：${state}` });
    if (openAgent) {
      const chat = banner.createEl('button', { cls: 'kos-status-banner-btn', attr: { 'aria-label': '在 Agent 中讨论此对象' } });
      setIcon(chat, 'message-square');
      chat.addEventListener('click', () => openAgent(obj.filePath));
    }
    const targets = legalTransitions(obj);
    if (targets.length > 0) {
      const btnGroup = banner.createSpan({ cls: 'kos-status-banner-actions' });
      for (const t of targets) {
        const btn = btnGroup.createEl('button', {
          cls: 'kos-status-banner-btn',
          text: `→ ${t.to}`,
        });
        if (t.note) btn.title = t.note;
        btn.addEventListener('click', () => {
          void applyTransition(app, obj, t.to, getSettings(), operation).catch((error) =>
            new Notice(error instanceof Error ? error.message : String(error)),
          );
        });
      }
    }
    el.prepend(banner);
  };
}
