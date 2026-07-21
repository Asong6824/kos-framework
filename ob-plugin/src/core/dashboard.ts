import { isPendingReview, pipelineFunnel, projectProgress, todayProgress } from './metrics';
import type { MetricSettings } from './metrics';
import type {
  KosObject,
  KosObjectType,
  Priority,
  ProjectObject,
  SourceObject,
  TaskObject,
} from './model';
import type { DailySnapshot } from './snapshot';

export type DashboardModule = 'today' | 'action' | 'input' | 'knowledge' | 'review' | 'system';

export interface AttentionSummary {
  overdue: number;
  blocked: number;
  staleProjects: number;
  inputBacklog: number;
  pendingReview: number;
}

export interface ProjectRow {
  object: ProjectObject;
  done: number;
  total: number;
  ratio: number | null;
  stale: boolean;
  overdue: boolean;
  blockedTasks: number;
}

export interface KnowledgeRow {
  object: Extract<KosObject, { type: 'research' | 'concept' | 'method' }>;
  state: string;
  updated: string | null;
}

export interface PageSlice<T> {
  items: T[];
  page: number;
  totalPages: number;
  totalItems: number;
  start: number;
  end: number;
}

const PRIORITY_ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };

export function paginate<T>(items: T[], requestedPage: number, pageSize = 10): PageSlice<T> {
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 10;
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / size));
  const normalizedPage = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1;
  const page = Math.min(totalPages, Math.max(1, normalizedPage));
  const startIndex = (page - 1) * size;
  const pageItems = items.slice(startIndex, startIndex + size);
  return {
    items: pageItems,
    page,
    totalPages,
    totalItems,
    start: totalItems === 0 ? 0 : startIndex + 1,
    end: startIndex + pageItems.length,
  };
}

function priorityRank(priority?: Priority): number {
  return priority ? PRIORITY_ORDER[priority] : 5;
}

export function taskIsOverdue(task: TaskObject, today: string): boolean {
  return task.status !== 'done' && task.status !== 'cancelled' && task.due !== null && task.due < today;
}

export function taskIsDueToday(task: TaskObject, today: string): boolean {
  return task.status !== 'done' && task.status !== 'cancelled' && task.due === today;
}

export function sortTasks(tasks: TaskObject[], today: string): TaskObject[] {
  return [...tasks].sort((a, b) => {
    const blocked = Number(b.status === 'blocked') - Number(a.status === 'blocked');
    if (blocked !== 0) return blocked;
    const overdue = Number(taskIsOverdue(b, today)) - Number(taskIsOverdue(a, today));
    if (overdue !== 0) return overdue;
    const priority = priorityRank(a.priority) - priorityRank(b.priority);
    if (priority !== 0) return priority;
    const due = (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99');
    if (due !== 0) return due;
    return objectName(a).localeCompare(objectName(b), 'zh-CN');
  });
}

export function currentActionTasks(objects: KosObject[], today: string): TaskObject[] {
  return sortTasks(
    objects.filter(
      (object): object is TaskObject =>
        object.type === 'task' &&
        (object.status === 'doing' || object.status === 'blocked' || taskIsOverdue(object, today) || taskIsDueToday(object, today)),
    ),
    today,
  );
}

export function attentionSummary(
  objects: KosObject[],
  today: string,
  settings: MetricSettings,
): AttentionSummary {
  const tasks = objects.filter((object): object is TaskObject => object.type === 'task');
  return {
    overdue: tasks.filter((task) => taskIsOverdue(task, today)).length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    staleProjects: projectProgress(objects, today, settings).filter((project) => project.stale === true).length,
    inputBacklog: pipelineFunnel(objects).backlog,
    pendingReview: objects.filter(isPendingReview).length,
  };
}

function normalizedProjectRef(ref?: string): string | null {
  if (!ref) return null;
  const match = /^\[\[([^|#]+)(?:[|#].*)?\]\]$/.exec(ref.trim());
  return (match?.[1] ?? ref).replace(/\.md$/, '');
}

function taskBelongsToProject(task: TaskObject, project: ProjectObject): boolean {
  const ref = normalizedProjectRef(task.project);
  if (!ref) return false;
  const path = project.filePath.replace(/\.md$/, '');
  return ref === path || ref === path.slice(path.lastIndexOf('/') + 1);
}

export function projectRows(objects: KosObject[], today: string, settings: MetricSettings): ProjectRow[] {
  const projects = objects.filter((object): object is ProjectObject => object.type === 'project');
  const tasks = objects.filter((object): object is TaskObject => object.type === 'task');
  const progress = new Map(projectProgress(objects, today, settings).map((item) => [item.filePath, item]));
  return projects
    .map((project) => {
      const item = progress.get(project.filePath);
      const linked = tasks.filter((task) => taskBelongsToProject(task, project));
      return {
        object: project,
        done: item?.done ?? 0,
        total: item?.total ?? 0,
        ratio: item?.progress ?? null,
        stale: item?.stale === true,
        overdue: project.due !== null && project.due < today && !['completed', 'archived', 'cancelled'].includes(project.status),
        blockedTasks: linked.filter((task) => task.status === 'blocked').length,
      };
    })
    .sort((a, b) => {
      const anomalies = Number(b.stale || b.overdue || b.blockedTasks > 0) - Number(a.stale || a.overdue || a.blockedTasks > 0);
      if (anomalies !== 0) return anomalies;
      const priority = priorityRank(a.object.priority) - priorityRank(b.object.priority);
      if (priority !== 0) return priority;
      return objectName(a.object).localeCompare(objectName(b.object), 'zh-CN');
    });
}

export function sourceRows(objects: KosObject[]): SourceObject[] {
  const order = ['captured', 'extracted', 'summarized', 'reviewed', 'linked', 'archived', 'ignored'];
  return objects
    .filter((object): object is SourceObject => object.type === 'source')
    .sort((a, b) => {
      const state = order.indexOf(a.status) - order.indexOf(b.status);
      if (state !== 0) return state;
      const importance = priorityRank(a.importance === 'high' ? 'P0' : a.importance === 'medium' ? 'P2' : 'P4')
        - priorityRank(b.importance === 'high' ? 'P0' : b.importance === 'medium' ? 'P2' : 'P4');
      if (importance !== 0) return importance;
      return (b.created ?? '').localeCompare(a.created ?? '');
    });
}

export function knowledgeRows(objects: KosObject[]): KnowledgeRow[] {
  return objects
    .filter(
      (object): object is Extract<KosObject, { type: 'research' | 'concept' | 'method' }> =>
        object.type === 'research' || object.type === 'concept' || object.type === 'method',
    )
    .map((object) => ({ object, state: object.status, updated: object.updated }))
    .sort((a, b) => (b.updated ?? b.object.created ?? '').localeCompare(a.updated ?? a.object.created ?? ''));
}

export function pendingReviewRows(objects: KosObject[]): KosObject[] {
  return objects
    .filter(isPendingReview)
    .sort((a, b) => (objectUpdated(b) ?? '').localeCompare(objectUpdated(a) ?? ''));
}

export function statusDistribution(objects: KosObject[], types: KosObjectType[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const object of objects) {
    if (!types.includes(object.type)) continue;
    const state = objectState(object);
    if (state) result[state] = (result[state] ?? 0) + 1;
  }
  return result;
}

export function inputProgress(objects: KosObject[], snapshots: DailySnapshot[], today: string) {
  return todayProgress(objects, snapshots, today).input;
}

export function objectName(object: KosObject): string {
  const title = 'title' in object && typeof object.title === 'string' ? object.title : '';
  return title || object.filePath.split('/').pop()?.replace(/\.md$/, '') || object.filePath;
}

export function objectState(object: KosObject): string | null {
  if (object.type === 'extract') return object.review_status;
  if (object.type === 'summary') return String(object.reviewed);
  if ('status' in object && typeof object.status === 'string') return object.status;
  return null;
}

export function objectUpdated(object: KosObject): string | null {
  if ('updated' in object && typeof object.updated === 'string') return object.updated;
  return object.created;
}
