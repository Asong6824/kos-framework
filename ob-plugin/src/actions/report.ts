/**
 * report.ts — A7 周报 / 月报（M14）
 *
 * 数据一律调 core weeklyReport/monthlyReport；渲染为中文 markdown 后：
 * - Modal 展示（MarkdownRenderer）；
 * - 一键复制到剪贴板；
 * - 写入日记对应章节（周报 → 周复盘，月报 → 月复盘）：只追加，绝不覆盖已有正文；
 *   文件不存在先按日记模板创建（复用 create.ts ensureDiary）。
 * 上期快照缺失 / estimated（补落）时在报告中按 03 文档通用约定 6 标注。
 */

import { App, Component, MarkdownRenderer, Modal, Notice, TFile } from 'obsidian';
import { monthlyReport, weeklyReport } from '../core/metrics';
import type { MetricSettings, PeriodReport } from '../core/metrics';
import { addDays, startOfMonth, startOfWeek } from '../core/snapshot';
import type { KosIndex } from '../data/index';
import { KosDataStore, localToday } from '../data/store';
import { BADGE_NAMES } from '../views/components';
import type { BadgeId } from '../core/metrics';

/** 报告生成所需依赖（main.ts 注入，避免反向依赖插件类） */
export interface ReportDeps {
  index: KosIndex;
  store: KosDataStore;
  metricSettings: () => MetricSettings;
  ensureDiary: (date: string) => Promise<TFile>;
}

/** 环比文案：+N（+X%）；上期为 0（pct null）时只显示绝对值 */
function deltaPart(delta: number, pct: number | null): string {
  const sign = delta >= 0 ? '+' : '';
  return pct === null ? `${sign}${delta}` : `${sign}${delta}（${sign}${Math.round(pct * 100)}%）`;
}

/** 百分比或 — */
function pctText(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

function reportTitle(r: PeriodReport): string {
  return r.period === 'week' ? `kos 周报（${r.start} ~ ${r.end}）` : `kos 月报（${r.start} ~ ${r.end}）`;
}

/** 报告正文（不含标题；标题层级由调用方决定） */
function reportBody(r: PeriodReport): string {
  const lines: string[] = [];
  lines.push(`> 对比上期（${r.prevStart} ~ ${r.prevEnd}）。`);
  if (r.prevSnapshotMissing) {
    lines.push('> ⚠️ 上期对比快照缺失（插件未运行），环比字段不可用（03 文档通用约定 6）。');
  } else if (r.prevSnapshotEstimated) {
    lines.push('> ⚠️ 上期对比快照为补落（estimated），不参与环比判定，增量字段不可用（03 文档通用约定 6）。');
  }
  lines.push('');

  lines.push('## 新增');
  lines.push(`- 本期新增 **${r.newTotal}**（环比 ${deltaPart(r.newDelta, r.newPct)}）`);
  const byType = Object.entries(r.newByType)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([t, n]) => `${t} ${n}`);
  if (byType.length > 0) lines.push(`- 分类：${byType.join(' · ')}`);
  lines.push('');

  lines.push('## 任务与管道');
  lines.push(`- 完成任务 **${r.tasksCompleted}**（上期 ${r.prevTasksCompleted}）`);
  lines.push(`- 输入管道整体转化率 **${pctText(r.conversion)}**（上期 ${pctText(r.prevConversion)}）`);
  lines.push(`- 当前积压 **${r.backlog}**（上期 ${r.prevBacklog === null ? '—' : r.prevBacklog}）`);
  lines.push('');

  lines.push('## 成熟度与坚持');
  lines.push(
    `- 知识成熟度 **${r.maturity}** 分` + (r.maturityDelta === null ? '（增量不可用）' : `（较上期 ${r.maturityDelta >= 0 ? '+' : ''}${r.maturityDelta}）`),
  );
  lines.push(`- 当前待审核 **${r.pendingReview}** 项` + (r.reviewClearCount !== undefined ? `；审核清零累计 ${r.reviewClearCount} 次` : ''));
  lines.push(`- 当前连续活跃 **${r.streakCurrent}** 天`);
  lines.push('');

  if (r.newBadges && r.newBadges.length > 0) {
    lines.push('## 新解锁徽章');
    for (const b of r.newBadges) lines.push(`- 🏅 ${b}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** 完整 markdown（Modal 展示 / 剪贴板用） */
export function reportMarkdown(r: PeriodReport): string {
  return `# ${reportTitle(r)}\n\n${reportBody(r)}`;
}

/** 写入日记的版本：正文标题降一级，嵌进"周复盘/月复盘"章节 */
function diaryBlock(r: PeriodReport): string {
  return `### ${reportTitle(r)}\n\n${reportBody(r).replace(/^## /gm, '### ')}`;
}

/**
 * 把内容追加到指定章节末尾；章节不存在则在文件末尾新建章节。
 * 只追加，不改动已有任何行（含 `<!-- 人手动添加 -->` 块）。
 */
export function appendToSection(content: string, heading: string, block: string): string {
  const lines = content.split('\n');
  const headRe = new RegExp(`^##\\s+${heading}\\s*$`);
  const idx = lines.findIndex((l) => headRe.test(l));
  if (idx === -1) {
    const sep = content.endsWith('\n') || content === '' ? '' : '\n';
    return `${content}${sep}\n## ${heading}\n\n${block}\n`;
  }
  // 章节终结于下一个同级或更高级标题
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const insertion = ['', block, ''];
  lines.splice(end, 0, ...insertion);
  return lines.join('\n');
}

/** 周报写入目标日期：本周最后一天（周起始 +6），尚未到则写当天 */
function reportDiaryDate(r: PeriodReport, today: string, weekStart: number): string {
  if (r.period === 'month') return today;
  const weekEnd = addDays(startOfWeek(today, weekStart), 6);
  return weekEnd < today ? weekEnd : today;
}

/** "写入日记"按钮动作 */
async function writeToDiary(app: App, r: PeriodReport, deps: ReportDeps, today: string): Promise<void> {
  const weekStart = deps.metricSettings().weekStart ?? 1;
  const date = reportDiaryDate(r, today, weekStart);
  const section = r.period === 'week' ? '周复盘' : '月复盘';
  const file = await deps.ensureDiary(date);
  const content = await app.vault.read(file);
  await app.vault.modify(file, appendToSection(content, section, diaryBlock(r)));
  new Notice(`已写入 ${date} 日记的「${section}」章节`);
}

class ReportModal extends Modal {
  constructor(
    app: App,
    private readonly report: PeriodReport,
    private readonly deps: ReportDeps,
    private readonly today: string,
  ) {
    super(app);
  }

  /** MarkdownRenderer 需要 Component（本版 API 中 Modal 不再继承 Component），单独持有一个 */
  private readonly mdComp = new Component();

  onOpen(): void {
    this.mdComp.load();
    const { contentEl } = this;
    contentEl.addClass('kos-modal', 'kos-report-modal');
    const md = reportMarkdown(this.report);
    const preview = contentEl.createDiv({ cls: 'kos-report-preview' });
    void MarkdownRenderer.render(this.app, md, preview, '', this.mdComp);

    const row = contentEl.createDiv({ cls: 'kos-modal-buttons' });
    const copy = row.createEl('button', { text: '复制到剪贴板' });
    copy.addEventListener('click', () => {
      void navigator.clipboard
        .writeText(md)
        .then(() => new Notice('报告已复制到剪贴板'))
        .catch(() => new Notice('复制失败：剪贴板不可用'));
    });
    const toDiary = row.createEl('button', { cls: 'mod-cta', text: '写入日记' });
    toDiary.addEventListener('click', () => void writeToDiary(this.app, this.report, this.deps, this.today));
    const close = row.createEl('button', { text: '关闭' });
    close.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.mdComp.unload();
    this.contentEl.empty();
  }
}

/** A7 入口：生成并展示周报/月报 */
export function openReportModal(app: App, deps: ReportDeps, period: 'week' | 'month'): void {
  const today = localToday();
  const ms = deps.metricSettings();
  const objects = deps.index.getAll();
  const snapshots = deps.store.snapshotList();

  // extras：M9 清零累计次数 + 本周期内新解锁的徽章名（badges 记录解锁日期，可重复徽章为 null 不计）
  const start = period === 'week' ? startOfWeek(today, ms.weekStart ?? 1) : startOfMonth(today);
  const unlocked = deps.store.pluginData.badges;
  const periodBadges = Object.entries(unlocked)
    .filter(([, date]) => typeof date === 'string' && date >= start && date <= today)
    .map(([id]) => BADGE_NAMES[id as BadgeId] ?? id);

  const extras = { reviewClearCount: deps.store.pluginData.reviewClearCount, newBadges: periodBadges };
  const report =
    period === 'week'
      ? weeklyReport(objects, snapshots, today, ms, extras)
      : monthlyReport(objects, snapshots, today, ms, extras);
  new ReportModal(app, report, deps, today).open();
}
