/**
 * heatmap-view.ts — A2 活动热力图 + Streak（右侧栏）
 *
 * M5 近 365 天日历热力图 + M6 当前/最长 streak 两个大数字。
 * 历史由 created/completed/日记 date 回填，安装第一天即完整（core 负责）。
 */

import type { WorkspaceLeaf } from 'obsidian';
import { activityHeatmap, activityStreak } from '../core/metrics';
import { heatmapGrid } from './components';
import { KosView } from './view-context';
import type { ViewContext } from './view-context';

export const HEATMAP_VIEW_TYPE = 'kos-heatmap';

export class HeatmapView extends KosView {
  constructor(leaf: WorkspaceLeaf, ctx: ViewContext) {
    super(leaf, ctx);
  }

  getViewType(): string {
    return HEATMAP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '活动热力图';
  }

  getIcon(): string {
    return 'calendar-days';
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('kos-view', 'kos-heatmap-view');

    const objects = this.ctx.index.getAll();
    const today = this.today();
    const ms = this.ctx.metricSettings();

    // M6 当前 / 最长 streak
    const streak = activityStreak(objects, today, ms);
    const row = contentEl.createDiv({ cls: 'kos-stat-row' });
    for (const [label, value] of [
      ['当前连续', streak.current],
      ['历史最长', streak.longest],
    ] as Array<[string, number]>) {
      const item = row.createDiv({ cls: 'kos-stat-item' });
      item.createDiv({ cls: 'kos-big-number', text: String(value) });
      item.createDiv({ cls: 'kos-muted', text: `${label}（天）` });
    }

    // M5 热力图（近 365 天）
    const scores = activityHeatmap(objects, ms);
    const sec = this.section(contentEl, '活动热力图');
    heatmapGrid(sec, scores, { today, days: 365, weekStart: ms.weekStart ?? 1 });
  }
}
