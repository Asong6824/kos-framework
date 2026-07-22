import { describe, expect, it } from 'vitest';
import {
  attentionSummary,
  currentActionTasks,
  expandedBentoRows,
  goalAllocationSummary,
  paginate,
  projectRows,
  sortTasks,
  statusDistribution,
  taskArchiveCandidates,
  todayScheduleEntries,
  truncateLabel,
} from '../src/core/dashboard';
import type { KosObject } from '../src/core/model';

const TODAY = '2026-07-21';
const SETTINGS = { staleThresholdDays: 14, heatmapIncludeDiary: true };

function object(type: KosObject['type'], fields: Record<string, unknown>): KosObject {
  return { type, filePath: `${type}/${String(fields.title ?? type)}.md`, created: TODAY, tags: [], ...fields } as unknown as KosObject;
}

describe('phase-two dashboard model', () => {
  it('sorts blocked, overdue, priority, due date, then title', () => {
    const tasks = [
      object('task', { title: 'C', status: 'todo', priority: 'P0', due: '2026-07-30', completed: null }),
      object('task', { title: 'B', status: 'todo', priority: 'P4', due: '2026-07-20', completed: null }),
      object('task', { title: 'A', status: 'blocked', priority: 'P4', due: null, completed: null }),
    ].filter((item): item is Extract<KosObject, { type: 'task' }> => item.type === 'task');
    expect(sortTasks(tasks, TODAY).map((task) => task.title)).toEqual(['A', 'B', 'C']);
  });

  it('limits current actions to doing, blocked, overdue, and due today', () => {
    const objects = [
      object('task', { title: 'doing', status: 'doing', due: null, completed: null }),
      object('task', { title: 'today', status: 'todo', due: TODAY, completed: null }),
      object('task', { title: 'future', status: 'todo', due: '2026-07-22', completed: null }),
      object('task', { title: 'done', status: 'done', due: '2026-07-19', completed: TODAY }),
    ];
    expect(currentActionTasks(objects, TODAY).map((task) => task.title)).toEqual(['today', 'doing']);
  });

  it('offers archiving only for completed linked Tasks outside the archive', () => {
    const linked = { ...object('task', { title: 'linked', status: 'done', projects: ['[[31_项目/A/A]]'], completed: TODAY }), filePath: '32_任务/linked.md' } as Extract<KosObject, { type: 'task' }>;
    const loose = { ...object('task', { title: 'loose', status: 'done', projects: [], completed: TODAY }), filePath: '32_任务/loose.md' } as Extract<KosObject, { type: 'task' }>;
    const open = { ...object('task', { title: 'open', status: 'todo', projects: ['[[31_项目/A/A]]'], completed: null }), filePath: '32_任务/open.md' } as Extract<KosObject, { type: 'task' }>;
    const archived = { ...linked, title: 'archived', filePath: '32_任务/归档/2026/archived.md' } as typeof linked;
    expect(taskArchiveCandidates([linked, loose, open, archived]).map((task) => task.title)).toEqual(['linked']);
  });

  it('builds today schedule from active due-today tasks with sorted times', () => {
    const objects = [
      object('task', { title: '晚间同步', status: 'todo', due: TODAY, scheduled_times: ['21:00'], completed: null }),
      object('task', { title: '双次抓取', status: 'doing', due: TODAY, scheduled_times: ['09:00', '18:00'], completed: null }),
      object('task', { title: '无时刻', status: 'todo', due: TODAY, scheduled_times: [], completed: null }),
      object('task', { title: '未来任务', status: 'todo', due: '2026-07-22', scheduled_times: ['08:00'], completed: null }),
      object('task', { title: '已完成', status: 'done', due: TODAY, scheduled_times: ['07:00'], completed: TODAY }),
    ];
    expect(todayScheduleEntries(objects, TODAY).map((entry) => ({ title: entry.task.title, times: entry.times }))).toEqual([
      { title: '双次抓取', times: ['09:00', '18:00'] },
      { title: '晚间同步', times: ['21:00'] },
    ]);
  });

  it('builds attention counts from deterministic metrics', () => {
    const objects = [
      object('task', { status: 'blocked', due: '2026-07-20', completed: null }),
      object('source', { status: 'captured' }),
      object('concept', { status: 'draft', updated: TODAY, aliases: [] }),
    ];
    expect(attentionSummary(objects, TODAY, SETTINGS)).toEqual({
      overdue: 1,
      blocked: 1,
      staleProjects: 0,
      inputBacklog: 1,
      pendingReview: 1,
    });
  });

  it('summarizes the current half-year Goal allocation', () => {
    const objects = [
      object('goal', { title: 'A', period: '2026-H2', status: 'active', allocation_weight: 60, health: 'on_track' }),
      object('goal', { title: 'B', period: '2026-H2', status: 'active', allocation_weight: 40, health: 'unknown' }),
      object('goal', { title: 'Later', period: '2027-H1', status: 'draft', allocation_weight: 0, health: 'unknown' }),
    ];
    expect(goalAllocationSummary(objects, TODAY)).toMatchObject({ period: '2026-H2', activeTotal: 100, valid: true });
    expect(goalAllocationSummary(objects, TODAY).goals.map((goal) => goal.title)).toEqual(['A', 'B']);
  });

  it('matches wikilink task refs to project progress and flags', () => {
    const project = object('project', {
      title: 'Alpha', status: 'active', priority: 'P1', due: '2026-07-20', updated: '2026-06-01',
    });
    const task = object('task', {
      title: 'Next', status: 'blocked', project: '[[project/Alpha]]', priority: 'P1', due: null, completed: null,
    });
    const [row] = projectRows([project, task], TODAY, SETTINGS);
    expect(row).toMatchObject({ total: 1, done: 0, stale: true, overdue: true, blockedTasks: 1 });
  });

  it('counts status distribution without inventing a funnel', () => {
    const objects = [
      object('concept', { status: 'draft', updated: TODAY, aliases: [] }),
      object('concept', { status: 'mature', updated: TODAY, aliases: [] }),
      object('method', { status: 'trusted', updated: TODAY, applicable_scenarios: [], validated_times: 3 }),
    ];
    expect(statusDistribution(objects, ['concept', 'method'])).toEqual({ draft: 1, mature: 1, trusted: 1 });
  });

  it('paginates at five items and clamps invalid pages', () => {
    const items = Array.from({ length: 23 }, (_, index) => index + 1);
    expect(paginate(items, 1)).toMatchObject({ items: [1, 2, 3, 4, 5], page: 1, totalPages: 5, start: 1, end: 5 });
    expect(paginate(items, 3)).toMatchObject({ items: [11, 12, 13, 14, 15], page: 3, totalPages: 5, start: 11, end: 15 });
    expect(paginate(items, 99)).toMatchObject({ items: [21, 22, 23], page: 5, totalPages: 5, start: 21, end: 23 });
    expect(paginate([], -1)).toMatchObject({ items: [], page: 1, totalPages: 1, start: 0, end: 0 });
  });

  it('keeps the beginning of long labels and adds one ellipsis', () => {
    expect(truncateLabel('大型语言模型的检索增强生成：从原理到实践', 8)).toBe('大型语言模型的检…');
    expect(truncateLabel('短标题', 8)).toBe('短标题');
    expect(truncateLabel('A😀BC', 2)).toBe('A😀…');
  });

  it('expands Bento cards in complete row units', () => {
    expect(expandedBentoRows(376, 180, 16, 2)).toBe(2);
    expect(expandedBentoRows(377, 180, 16, 2)).toBe(3);
    expect(expandedBentoRows(760, 180, 16, 2)).toBe(4);
    expect(expandedBentoRows(100, 180, 16, 3)).toBe(3);
  });
});
