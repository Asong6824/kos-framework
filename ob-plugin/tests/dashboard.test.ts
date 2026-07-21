import { describe, expect, it } from 'vitest';
import {
  attentionSummary,
  currentActionTasks,
  paginate,
  projectRows,
  sortTasks,
  statusDistribution,
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

  it('paginates at ten items and clamps invalid pages', () => {
    const items = Array.from({ length: 23 }, (_, index) => index + 1);
    expect(paginate(items, 1)).toMatchObject({ items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], page: 1, totalPages: 3, start: 1, end: 10 });
    expect(paginate(items, 3)).toMatchObject({ items: [21, 22, 23], page: 3, totalPages: 3, start: 21, end: 23 });
    expect(paginate(items, 99)).toMatchObject({ page: 3, totalPages: 3 });
    expect(paginate([], -1)).toMatchObject({ items: [], page: 1, totalPages: 1, start: 0, end: 0 });
  });
});
