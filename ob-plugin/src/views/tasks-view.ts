/**
 * tasks-view.ts — B6 聚合任务视图（右侧栏）
 *
 * 聚合 32_任务 中 todo/doing/blocked 的 task，按 priority（P0 优先）再按 due 排序；
 * 按项目分区块，项目区块显示 mergedProjectProgress 进度条，停滞项目（M10）标黄。
 */

import type { WorkspaceLeaf } from 'obsidian';
import { wikilinkTarget } from '../core/metrics';
import { PRIORITIES } from '../core/model';
import type { TaskObject } from '../core/model';
import { KosView, objectTitle } from './view-context';
import type { ViewContext } from './view-context';

export const TASKS_VIEW_TYPE = 'kos-tasks';

/** 参与聚合的进行中状态 */
const OPEN_STATUSES = new Set(['todo', 'doing', 'blocked']);

/** 任务排序键：priority（P0 优先，缺失排最后）→ due（缺失排最后）→ 标题 */
function compareTasks(a: TaskObject, b: TaskObject): number {
  const pa = a.priority ? PRIORITIES.indexOf(a.priority) : PRIORITIES.length;
  const pb = b.priority ? PRIORITIES.indexOf(b.priority) : PRIORITIES.length;
  if (pa !== pb) return pa - pb;
  const da = a.due ?? '9999-12-31';
  const db = b.due ?? '9999-12-31';
  if (da !== db) return da < db ? -1 : 1;
  return objectTitle(a).localeCompare(objectTitle(b));
}

export class TasksView extends KosView {
  constructor(leaf: WorkspaceLeaf, ctx: ViewContext) {
    super(leaf, ctx);
  }

  getViewType(): string {
    return TASKS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '聚合任务';
  }

  getIcon(): string {
    return 'list-checks';
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('kos-view', 'kos-tasks-view');

    const today = this.today();
    const ms = this.ctx.metricSettings();
    const tasks = this.ctx.index
      .byType('task')
      .filter((t) => OPEN_STATUSES.has(t.status))
      .sort(compareTasks);
    const projects = this.ctx.index
      .byType('project')
      .filter((p) => p.status === 'active' || p.status === 'idea' || p.status === 'paused');

    if (tasks.length === 0 && projects.length === 0) {
      contentEl.createDiv({ cls: 'kos-empty', text: '暂无待办任务' });
      return;
    }

    // 多 Project Task 以关联集合分组，避免同一 Task 在聚合视图重复出现。
    const byProject = new Map<string, TaskObject[]>();
    const unassigned: TaskObject[] = [];
    for (const t of tasks) {
      const key = t.projects.length ? t.projects.map(wikilinkTarget).sort().join(' + ') : '';
      if (key === '') {
        unassigned.push(t);
        continue;
      }
      const list = byProject.get(key);
      if (list) list.push(t);
      else byProject.set(key, [t]);
    }

    // 项目区块（停滞优先展示），进度条用 mergedProjectProgress（含项目页 checkbox）
    const blocks = projects
      .map((p) => ({ project: p, progress: this.ctx.index.mergedProjectProgress(p, today, ms) }))
      .sort((a, b) => Number(b.progress.stale === true) - Number(a.progress.stale === true));

    const seenKeys = new Set<string>();
    for (const { project, progress } of blocks) {
      seenKeys.add(progress.title);
      const mine = byProject.get(progress.title) ?? [];
      const sec = this.section(contentEl, progress.title);
      const block = sec.createDiv({ cls: 'kos-project-block' });
      if (progress.stale === true) {
        block.addClass('kos-stale');
        block.createSpan({ cls: 'kos-stale-tag', text: `停滞 ${progress.daysSinceUpdate ?? ''} 天` });
      }
      const head = block.createDiv({ cls: 'kos-project-head' });
      const titleEl = head.createEl('a', { cls: 'kos-project-title', text: progress.title });
      titleEl.addEventListener('click', () => void this.openFile(project.filePath));
      head.createSpan({
        cls: 'kos-muted',
        text: progress.progress === null ? '—' : `${progress.done}/${progress.total}`,
      });
      const bar = block.createDiv({ cls: 'kos-progress' });
      const fill = bar.createDiv({ cls: 'kos-progress-fill' });
      fill.style.width = progress.progress === null ? '0%' : `${Math.round(progress.progress * 100)}%`;
      for (const t of mine) this.renderTask(block, t);
    }

    // 未关联到存活项目的任务（含 project 指向不存在/已归档项目的情况）
    const orphans = unassigned.concat(
      tasks.filter((t) => {
        const key = t.projects.length ? t.projects.map(wikilinkTarget).sort().join(' + ') : '';
        return key !== '' && !seenKeys.has(key);
      }),
    );
    if (orphans.length > 0) {
      const sec = this.section(contentEl, '未关联项目');
      for (const t of orphans) this.renderTask(sec, t);
    }
  }

  /** 单行任务：优先级徽章 + 标题（点击打开）+ 状态 + 截止日 */
  private renderTask(parent: HTMLElement, t: TaskObject): void {
    const row = parent.createDiv({ cls: 'kos-task-row' });
    if (t.priority) row.createSpan({ cls: `kos-priority kos-priority-${t.priority}`, text: t.priority });
    const titleEl = row.createEl('a', { cls: 'kos-task-title', text: objectTitle(t) });
    titleEl.addEventListener('click', () => void this.openFile(t.filePath));
    row.createSpan({ cls: 'kos-tag', text: t.status });
    if (t.due) row.createSpan({ cls: 'kos-muted', text: `截止 ${t.due}` });
  }
}
