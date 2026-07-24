import { objectName } from '../../core/dashboard';
import type { GoalAllocationSummary, GoalProgress } from '../../core/dashboard';
import type { GoalHealth, GoalObject, GoalStatus } from '../../core/model';

const SEGMENT_COUNT = 20;
const VISIBLE_GOALS = 3;

const STATUS_LABELS: Record<GoalStatus, string> = {
  draft: '草稿',
  active: '进行中',
  paused: '暂停',
  achieved: '已达成',
  abandoned: '已放弃',
  archived: '已归档',
};

const HEALTH_LABELS: Record<GoalHealth, string> = {
  unknown: '未判断',
  on_track: '正常',
  at_risk: '有风险',
  off_track: '已偏离',
};

export function goalProgressSegments(ratio: number | null): number {
  return ratio === null ? 0 : Math.round(Math.min(1, Math.max(0, ratio)) * SEGMENT_COUNT);
}

function goalTone(goal: GoalObject): string {
  if (goal.health === 'off_track') return 'danger';
  if (goal.health === 'at_risk' || goal.status === 'paused') return 'warning';
  if (goal.status === 'achieved') return 'success';
  return 'neutral';
}

export function renderGoalOverview(
  parent: HTMLElement,
  summary: GoalAllocationSummary,
  progressForGoal: (goal: GoalObject) => GoalProgress,
  openGoal?: (goal: GoalObject) => void,
): HTMLElement {
  const root = parent.createEl('section', {
    cls: 'kos-goal-overview',
    attr: { 'aria-label': `${summary.period} 目标概览，投入占比 ${summary.activeTotal} / 100` },
  });
  const head = root.createDiv({ cls: 'kos-goal-overview-head' });
  const title = head.createDiv({ cls: 'kos-goal-overview-title' });
  title.createSpan({ text: 'GOALS' });
  title.createSpan({ cls: 'kos-goal-overview-separator', text: '·' });
  title.createSpan({ text: '目标' });
  head.createSpan({ cls: 'kos-goal-overview-period', text: summary.period || 'CURRENT' });

  const hero = root.createDiv({ cls: 'kos-goal-overview-hero' });
  hero.createSpan({ cls: `kos-goal-overview-total${summary.valid ? '' : ' is-invalid'}`, text: String(summary.activeTotal) });
  const heroMeta = hero.createDiv({ cls: 'kos-goal-overview-hero-meta' });
  heroMeta.createSpan({ text: '/ 100' });
  heroMeta.createSpan({ text: 'ACTIVE ALLOCATION' });

  const list = root.createDiv({ cls: 'kos-goal-overview-list' });
  if (!summary.goals.length) {
    list.createDiv({ cls: 'kos-goal-overview-empty', text: '当前半年还没有目标' });
  } else {
    for (const goal of summary.goals.slice(0, VISIBLE_GOALS)) {
      const progress = progressForGoal(goal);
      const progressPercent = progress.ratio === null ? null : Math.round(progress.ratio * 100);
      const row = list.createDiv({ cls: 'kos-goal-overview-row' });
      const rowHead = row.createDiv({ cls: 'kos-goal-overview-row-head' });
      const name = rowHead.createEl('button', {
        cls: 'kos-goal-overview-name',
        text: objectName(goal),
        attr: { type: 'button', title: objectName(goal) },
      });
      if (openGoal) name.addEventListener('click', () => openGoal(goal));
      rowHead.createSpan({ cls: `kos-goal-overview-state is-${goalTone(goal)}`, text: `● ${STATUS_LABELS[goal.status]}` });
      rowHead.createSpan({ cls: 'kos-goal-overview-progress', text: progressPercent === null ? '—' : `${progressPercent}%` });
      const rail = row.createDiv({ cls: 'kos-goal-overview-rail', attr: { 'aria-hidden': 'true' } });
      const filled = goalProgressSegments(progress.ratio);
      for (let index = 0; index < SEGMENT_COUNT; index += 1) {
        rail.createSpan({ cls: index < filled ? 'is-filled' : '' });
      }
      row.createDiv({
        cls: 'kos-goal-overview-meta',
        text: `投入占比 ${goal.allocation_weight}% · 健康度 ${HEALTH_LABELS[goal.health]} · 结果指标 ${progress.metricCount} · 结果证据 ${goal.result_evidence.length}`,
      });
    }
  }

  const footer = root.createDiv({ cls: 'kos-goal-overview-footer' });
  footer.createSpan({ text: `NT-GL · G${summary.goals.length}` });
  footer.createSpan({ text: summary.valid ? 'ALLOCATION BALANCED' : 'ALLOCATION REVIEW' });
  return root;
}
