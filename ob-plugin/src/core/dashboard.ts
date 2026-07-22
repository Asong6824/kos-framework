import { isPendingReview, pipelineFunnel, projectProgress, todayProgress } from './metrics';
import type { MetricSettings } from './metrics';
import type {
  KosObject,
  KosObjectType,
  GoalObject,
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

export interface GoalAllocationSummary {
  period: string;
  goals: GoalObject[];
  activeTotal: number;
  valid: boolean;
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

export interface TodayScheduleEntry {
  task: TaskObject;
  times: string[];
}

const PRIORITY_ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };

export function halfYearPeriod(date: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!match) return '';
  return `${match[1]}-${Number(match[2]) <= 6 ? 'H1' : 'H2'}`;
}

export function goalAllocationSummary(objects: KosObject[], today: string): GoalAllocationSummary {
  const period = halfYearPeriod(today);
  const goals = objects
    .filter((object): object is GoalObject => object.type === 'goal' && object.period === period)
    .sort((a, b) => {
      const statusOrder = ['active', 'draft', 'paused', 'achieved', 'abandoned', 'archived'];
      return statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || b.allocation_weight - a.allocation_weight || objectName(a).localeCompare(objectName(b), 'zh-CN');
    });
  const active = goals.filter((goal) => goal.status === 'active');
  const activeTotal = active.reduce((sum, goal) => sum + goal.allocation_weight, 0);
  return { period, goals, activeTotal, valid: active.length === 0 || activeTotal === 100 };
}

export function truncateLabel(text: string, maxCharacters: number): string {
  const characters = Array.from(text);
  const limit = Number.isFinite(maxCharacters) ? Math.max(1, Math.floor(maxCharacters)) : characters.length;
  return characters.length > limit ? `${characters.slice(0, limit).join('')}…` : text;
}

export function expandedBentoRows(contentHeight: number, rowHeight: number, gap: number, minimumRows: number): number {
  const safeRow = Number.isFinite(rowHeight) ? Math.max(1, rowHeight) : 1;
  const safeGap = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  const safeMinimum = Number.isFinite(minimumRows) ? Math.max(1, Math.floor(minimumRows)) : 1;
  const safeContent = Number.isFinite(contentHeight) ? Math.max(0, contentHeight) : 0;
  return Math.max(safeMinimum, Math.ceil((safeContent + safeGap) / (safeRow + safeGap)));
}

export function paginate<T>(items: T[], requestedPage: number, pageSize = 5): PageSlice<T> {
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 5;
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

export function taskIsDeferred(task: TaskObject, today: string): boolean {
  return task.status === 'todo' && task.defer_until !== null && task.defer_until > today;
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
        !taskIsDeferred(object, today) &&
        (object.status === 'doing' || object.status === 'blocked' || taskIsOverdue(object, today) || taskIsDueToday(object, today)),
    ),
    today,
  );
}

export function taskArchiveCandidates(objects: KosObject[]): TaskObject[] {
  return objects.filter(
    (object): object is TaskObject =>
      object.type === 'task' &&
      object.status === 'done' &&
      object.projects.length > 0 &&
      object.filePath.startsWith('32_任务/') &&
      !object.filePath.startsWith('32_任务/归档/'),
  );
}

/** 今日仍活跃且声明了本地时刻的任务；按首个时刻、标题稳定排序。 */
export function todayScheduleEntries(objects: KosObject[], today: string): TodayScheduleEntry[] {
  return objects
    .filter(
      (object): object is TaskObject =>
        object.type === 'task' && !taskIsDeferred(object, today) && (object.scheduled_for === today || taskIsDueToday(object, today)) && object.scheduled_times.length > 0,
    )
    .map((task) => ({ task, times: [...task.scheduled_times] }))
    .sort((a, b) => a.times[0].localeCompare(b.times[0]) || objectName(a.task).localeCompare(objectName(b.task), 'zh-CN'));
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
  const path = project.filePath.replace(/\.md$/, '');
  const projects = task.projects ?? (task.project ? [task.project] : []);
  return projects.some((projectRef) => {
    const ref = normalizedProjectRef(projectRef);
    return ref === path || ref === path.slice(path.lastIndexOf('/') + 1);
  });
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
