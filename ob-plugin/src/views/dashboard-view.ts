import { Notice, setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import {
  attentionSummary,
  currentActionTasks,
  inputProgress,
  knowledgeRows,
  objectName,
  objectState,
  paginate,
  pendingReviewRows,
  projectRows,
  sortTasks,
  sourceRows,
  statusDistribution,
  taskIsDueToday,
  taskIsOverdue,
} from '../core/dashboard';
import type { DashboardModule, PageSlice, ProjectRow } from '../core/dashboard';
import { knowledgeAssetTotal, maturityScore, pipelineFunnel } from '../core/metrics';
import type { KosObject, SourceObject, TaskObject } from '../core/model';
import { legalTransitions } from '../core/transitions';
import type { KosValidationReport } from '../agent/protocol';
import { KosView, TYPE_LABELS, objectTitle } from './view-context';
import type { DashboardAgentSnapshot, ViewContext } from './view-context';

export const DASHBOARD_VIEW_TYPE = 'kos-dashboard';

type PaginationKey = 'todayTasks' | 'actionProjects' | 'actionTasks' | 'inputSources' | 'knowledgeRows' | 'reviewRows' | 'systemFindings';

const SOURCE_ACTION: Record<SourceObject['status'], string> = {
  captured: '提取重点', extracted: '生成摘要', summarized: '审阅摘要', reviewed: '建立关联', linked: '归档', archived: '已完结', ignored: '已忽略',
};

const STATE_LABELS: Record<string, string> = {
  todo: '待办', doing: '进行中', done: '完成', blocked: '受阻', cancelled: '取消',
  active: '进行中', idea: '想法', paused: '暂停', completed: '完成', archived: '归档',
  captured: '已捕获', extracted: '已摘录', summarized: '已摘要', reviewed: '已审阅', linked: '已关联', ignored: '已忽略',
  draft: '草稿', verified: '已验证', mature: '已成熟', complete: '完成', candidate: '候选', usable: '可用', trusted: '可信', deprecated: '弃用', pending: '待审阅',
};

function percent(value: number | null): string { return value === null ? '—' : `${Math.round(value * 100)}%`; }
function labelState(state: string): string { return STATE_LABELS[state] ?? state; }
function tone(state: string): string {
  if (['blocked', 'cancelled', 'deprecated', 'ignored', 'error'].includes(state)) return 'danger';
  if (['done', 'completed', 'complete', 'mature', 'trusted', 'linked', 'archived', 'reviewed', 'success', 'true'].includes(state)) return 'success';
  if (['paused', 'draft', 'candidate', 'captured', 'pending', 'warning'].includes(state)) return 'warning';
  return 'neutral';
}

export class DashboardView extends KosView {
  private inputFilter: 'pending' | 'all' | 'done' | 'ignored' = 'pending';
  private knowledgeFilter: 'all' | 'research' | 'concept' | 'method' = 'all';
  private agentSnapshot: DashboardAgentSnapshot | null = null;
  private validation: KosValidationReport | null = null;
  private systemLoading = false;
  private agentRunning = false;
  private agentGeneratedAt: string | null = null;
  private pages: Record<PaginationKey, number> = {
    todayTasks: 1,
    actionProjects: 1,
    actionTasks: 1,
    inputSources: 1,
    knowledgeRows: 1,
    reviewRows: 1,
    systemFindings: 1,
  };

  constructor(leaf: WorkspaceLeaf, ctx: ViewContext) { super(leaf, ctx); }
  getViewType(): string { return DASHBOARD_VIEW_TYPE; }
  getDisplayText(): string { return 'kos 看板'; }
  getIcon(): string { return 'layout-dashboard'; }

  setModule(module: DashboardModule): void {
    const target = this.contentEl.querySelector<HTMLElement>(`#kos-board-${module}`);
    if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
    else {
      this.render();
      window.requestAnimationFrame(() => this.contentEl.querySelector<HTMLElement>(`#kos-board-${module}`)?.scrollIntoView({ block: 'start' }));
    }
  }

  setAgentRunning(running: boolean): void {
    this.agentRunning = running;
    if (!running) this.agentGeneratedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.render();
  }

  render(): void {
    const { contentEl } = this;
    const previousScrollTop = contentEl.scrollTop;
    contentEl.empty();
    contentEl.addClass('kos-view', 'kos-dashboard-v2', 'kos-board-page');
    const canvas = contentEl.createEl('main', { cls: 'kos-board-canvas' });
    this.renderToday(this.boardSection(canvas, 'today'));
    this.renderAction(this.boardSection(canvas, 'action'));
    this.renderInput(this.boardSection(canvas, 'input'));
    this.renderKnowledge(this.boardSection(canvas, 'knowledge'));
    this.renderReview(this.boardSection(canvas, 'review'));
    this.renderSystem(this.boardSection(canvas, 'system'));
    contentEl.scrollTop = Math.min(previousScrollTop, Math.max(0, contentEl.scrollHeight - contentEl.clientHeight));
  }

  private boardSection(parent: HTMLElement, module: DashboardModule): HTMLElement {
    return parent.createEl('section', { cls: `kos-board-section kos-board-${module}`, attr: { id: `kos-board-${module}` } });
  }

  private renderToday(section: HTMLElement): void {
    const objects = this.ctx.index.getAll();
    const today = this.today();
    const tasks = currentActionTasks(objects, today);
    const attention = attentionSummary(objects, today, this.ctx.metricSettings());
    const head = this.sectionHeader(section, '今日', 'TODAY');
    head.createDiv({ cls: 'kos-board-head-note', text: this.todayLabel() });

    const mainlineHead = this.subhead(section, '今日主线');
    mainlineHead.createSpan({ cls: 'kos-board-dashed-label', text: this.agentGeneratedAt ? `AGENT 建议 · ${this.agentGeneratedAt}` : '确定性排序' });
    if (!tasks.length) {
      this.empty(section, '今天没有到期、进行中或受阻的任务', '新建任务', () => this.ctx.create?.('task'));
    } else {
      for (const task of tasks.slice(0, 2)) this.renderFocusCard(section, task, today);
    }

    this.subhead(section, '需要关注');
    const attentionRow = section.createDiv({ cls: 'kos-board-attention' });
    this.attention(attentionRow, attention.overdue, '逾期', 'danger');
    this.attention(attentionRow, attention.blocked, '受阻', 'danger');
    this.attention(attentionRow, attention.staleProjects, '停滞项目', 'warning');
    this.attention(attentionRow, attention.inputBacklog, '输入积压', 'neutral');
    this.attention(attentionRow, attention.pendingReview, '待审阅', 'warning');
    this.attention(attentionRow, this.validation?.warningCount ?? 0, '系统警告', 'warning');
    this.attention(attentionRow, this.validation?.errorCount ?? 0, '系统错误', 'muted');

    this.subhead(section, '当前行动', 'kos-today-actions');
    const taskPage = this.page('todayTasks', tasks);
    const list = section.createDiv({ cls: 'kos-board-lines' });
    for (const task of taskPage.items) this.renderTaskLine(list, task, today);
    this.pagination(section, 'todayTasks', taskPage, 'today', 'kos-today-actions');
    const foot = section.createDiv({ cls: 'kos-board-footer' });
    foot.createSpan({ text: `刷新 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` });
    const commands = foot.createDiv({ cls: 'kos-board-actions' });
    this.button(commands, '开始一天', false, () => this.runAgent('today', 'prioritize-today'));
    this.button(commands, '结束一天', false, () => this.runAgent('today', 'end-day'));
  }

  private renderFocusCard(parent: HTMLElement, task: TaskObject, today: string): void {
    const card = parent.createDiv({ cls: 'kos-board-focus-card' });
    const top = card.createDiv({ cls: 'kos-board-card-top' });
    const identity = top.createDiv({ cls: 'kos-board-card-title' });
    this.pill(identity, task.priority ?? 'P4', task.priority === 'P0' ? 'solid' : 'outline');
    this.pill(identity, '任务', 'outline');
    this.link(identity, objectName(task), () => void this.openFile(task.filePath));
    top.createSpan({ cls: 'kos-board-state', text: `● ${labelState(task.status)}` });
    card.createDiv({ cls: 'kos-board-card-copy', text: task.project ? `关联 ${task.project.replace(/\[|\]/g, '')}` : '尚未关联项目，可直接推进下一步。' });
    const bottom = card.createDiv({ cls: 'kos-board-card-bottom' });
    bottom.createSpan({ cls: 'kos-board-muted', text: task.project ? `关联 ${task.project.replace(/\[|\]/g, '')}` : `截止 ${task.due ?? '未记录'}` });
    const actions = bottom.createDiv({ cls: 'kos-board-actions' });
    if (legalTransitions(task).some((target) => target.to === 'done')) this.button(actions, '完成', true, () => void this.ctx.transition?.(task, 'done'));
    this.button(actions, task.status === 'blocked' ? '分析阻塞' : '交给 AGENT', false, () => this.runAgent('today', task.status === 'blocked' ? 'resolve-blocker' : 'update-task', [task], task.filePath));
    if (taskIsOverdue(task, today)) card.addClass('is-danger');
  }

  private renderAction(section: HTMLElement): void {
    const objects = this.ctx.index.getAll();
    const head = this.sectionHeader(section, '行动', 'ACTION');
    const tabs = head.createDiv({ cls: 'kos-board-switch' });
    this.anchorButton(tabs, '项目', true, 'kos-action-projects');
    this.anchorButton(tabs, '任务', false, 'kos-action-tasks');
    const projectHead = this.subhead(section, '项目', 'kos-action-projects');
    projectHead.createSpan({ text: '按优先级排序' });
    const projects = projectRows(objects, this.today(), this.ctx.metricSettings());
    if (!projects.length) this.empty(section, '暂无项目', '新建项目', () => this.ctx.create?.('project'));
    else {
      const projectPage = this.page('actionProjects', projects);
      for (const project of projectPage.items) this.renderProjectCard(section, project);
      this.pagination(section, 'actionProjects', projectPage, 'action', 'kos-action-projects');
    }
    const taskHead = this.subhead(section, '任务', 'kos-action-tasks');
    taskHead.createSpan({ cls: 'kos-board-mono', text: 'BLOCKED → OVERDUE → P0..P4' });
    const tasks = sortTasks(objects.filter((object): object is TaskObject => object.type === 'task'), this.today());
    const taskPage = this.page('actionTasks', tasks);
    const list = section.createDiv({ cls: 'kos-board-lines' });
    for (const task of taskPage.items) this.renderTaskLine(list, task, this.today());
    this.pagination(section, 'actionTasks', taskPage, 'action', 'kos-action-tasks');
    const foot = section.createDiv({ cls: 'kos-board-footer' });
    foot.createSpan({ text: `项目 ${projects.length} · 任务 ${tasks.length}` });
    foot.createSpan({ text: '完成与取消已折叠' });
  }

  private renderProjectCard(parent: HTMLElement, row: ProjectRow): void {
    const card = parent.createDiv({ cls: 'kos-board-project-card' });
    const top = card.createDiv({ cls: 'kos-board-card-top' });
    const title = top.createDiv({ cls: 'kos-board-card-title' });
    this.pill(title, row.object.priority ?? 'P4', row.object.priority === 'P0' ? 'solid' : 'outline');
    this.link(title, objectName(row.object), () => void this.openFile(row.object.filePath));
    top.createSpan({ cls: 'kos-board-state', text: `● ${labelState(row.object.status)}` });
    card.createDiv({ cls: 'kos-board-card-copy', text: row.object.goal || '项目目标未记录' });
    card.createDiv({ cls: 'kos-board-project-meta', text: `阶段 ${row.object.current_stage || '未记录'}　领域 ${row.object.area || '未记录'}　截止 ${row.object.due || '未记录'}　更新 ${row.object.updated || '未记录'}` });
    const progress = card.createDiv({ cls: 'kos-board-project-progress' });
    progress.createSpan({ cls: 'kos-board-mono', text: `${row.done} / ${row.total} · ${percent(row.ratio)}` });
    this.segmentRail(progress, row.ratio, 28);
    const bottom = card.createDiv({ cls: 'kos-board-card-bottom' });
    const flags = bottom.createDiv({ cls: 'kos-board-flags' });
    if (row.blockedTasks) flags.createSpan({ cls: 'is-warning', text: '● 包含阻塞任务' });
    if (row.stale) flags.createSpan({ cls: 'is-warning', text: '● 项目停滞' });
    if (row.overdue) flags.createSpan({ cls: 'is-danger', text: '● 已逾期' });
    const actions = bottom.createDiv({ cls: 'kos-board-actions' });
    this.button(actions, '更新进展', false, () => this.runAgent('action', 'update-project', [row.object], row.object.filePath));
    this.button(actions, '打开', false, () => void this.openFile(row.object.filePath));
  }

  private renderInput(section: HTMLElement): void {
    const objects = this.ctx.index.getAll();
    const pipeline = pipelineFunnel(objects);
    const progress = inputProgress(objects, this.ctx.store.snapshotList(), this.today());
    const head = this.sectionHeader(section, '输入', 'INPUT');
    head.createDiv({ cls: 'kos-board-head-note kos-board-mono', text: 'SOURCE 管道' });
    const distHead = this.subhead(section, '状态分布');
    distHead.createSpan({ text: '存量比例 · 非转化率' });
    const distribution = section.createDiv({ cls: 'kos-board-distribution-box' });
    const bar = distribution.createDiv({ cls: 'kos-board-source-bar' });
    const stageColors = ['s1', 's2', 's3', 's4', 's5', 's6'];
    const chain = ['captured', 'extracted', 'summarized', 'reviewed', 'linked', 'archived'] as const;
    chain.forEach((state, index) => {
      const segment = bar.createSpan({ cls: stageColors[index] });
      segment.style.flexGrow = String(Math.max(1, pipeline.stages[state]));
    });
    const legend = distribution.createDiv({ cls: 'kos-board-legend' });
    chain.forEach((state, index) => legend.createSpan({ cls: stageColors[index], text: `${labelState(state)} ${pipeline.stages[state]}` }));
    legend.createSpan({ cls: 'is-muted', text: `● 已忽略 ${pipeline.stages.ignored} · 不计入主链` });
    const stats = section.createDiv({ cls: 'kos-board-inline-stats' });
    this.inlineStat(stats, pipeline.backlog, '积压', 'warning');
    this.inlineStat(stats, percent(pipeline.conversion), '整体完结');
    this.inlineStat(stats, progress.processed ?? '—', progress.processed === null ? '今日处理 · 缺少昨日快照' : '今日处理');
    this.inlineStat(stats, this.ctx.index.inboxFiles().length, '收件箱未分类');
    const queueHead = this.subhead(section, '材料队列', 'kos-input-queue');
    const filters = queueHead.createDiv({ cls: 'kos-board-switch' });
    for (const [id, label] of [['pending', '待处理'], ['all', '全部'], ['done', '已完结'], ['ignored', '已忽略']] as const) {
      const button = filters.createEl('button', { cls: this.inputFilter === id ? 'is-active' : '', text: label });
      button.addEventListener('click', () => {
        this.inputFilter = id;
        this.pages.inputSources = 1;
        this.render();
        this.setModule('input');
      });
    }
    const sources = sourceRows(objects).filter((source) => {
      if (this.inputFilter === 'pending') return ['captured', 'extracted', 'summarized'].includes(source.status);
      if (this.inputFilter === 'done') return ['reviewed', 'linked', 'archived'].includes(source.status);
      if (this.inputFilter === 'ignored') return source.status === 'ignored';
      return true;
    });
    const sourcePage = this.page('inputSources', sources);
    const list = section.createDiv({ cls: 'kos-board-lines' });
    for (const source of sourcePage.items) this.renderSourceLine(list, source);
    this.pagination(section, 'inputSources', sourcePage, 'input', 'kos-input-queue');
    const foot = section.createDiv({ cls: 'kos-board-footer' });
    foot.createSpan({ text: `队列 ${sources.length} · 待处理 ${pipeline.backlog}` });
    foot.createSpan({ text: '继续处理由 AGENT 执行' });
  }

  private renderKnowledge(section: HTMLElement): void {
    const objects = this.ctx.index.getAll();
    const assets = knowledgeAssetTotal(objects);
    const distribution = statusDistribution(objects, ['research', 'concept', 'method']);
    const maturity = maturityScore(objects);
    const head = this.sectionHeader(section, '知识', 'KNOWLEDGE');
    head.createDiv({ cls: 'kos-board-head-note', text: '资产' });
    this.subhead(section, '资产摘要');
    const stats = section.createDiv({ cls: 'kos-board-inline-stats kos-board-knowledge-stats' });
    this.inlineStat(stats, assets.research, '研究');
    this.inlineStat(stats, assets.concept, '概念');
    this.inlineStat(stats, assets.method, '方法');
    this.subhead(section, '成熟度分布');
    const maturityBar = section.createDiv({ cls: 'kos-board-maturity-bar' });
    const total = Object.values(distribution).reduce((sum, count) => sum + count, 0) || 1;
    for (const [state, count] of Object.entries(distribution)) {
      const segment = maturityBar.createSpan({ cls: `is-${tone(state)}` });
      segment.style.flexGrow = String(Math.max(1, count / total));
    }
    const maturityLegend = section.createDiv({ cls: 'kos-board-legend' });
    for (const [state, count] of Object.entries(distribution)) maturityLegend.createSpan({ cls: `is-${tone(state)}`, text: `■ ${labelState(state)} ${count}` });
    const objectHead = this.subhead(section, '知识对象', 'kos-knowledge-objects');
    const tabs = objectHead.createDiv({ cls: 'kos-board-tabs' });
    for (const [id, label] of [['all', '全部'], ['research', '研究'], ['concept', '概念'], ['method', '方法']] as const) {
      const button = tabs.createEl('button', { cls: this.knowledgeFilter === id ? 'is-active' : '', text: label });
      button.addEventListener('click', () => {
        this.knowledgeFilter = id;
        this.pages.knowledgeRows = 1;
        this.render();
        this.setModule('knowledge');
      });
    }
    const rows = knowledgeRows(objects).filter((row) => this.knowledgeFilter === 'all' || row.object.type === this.knowledgeFilter);
    const rowPage = this.page('knowledgeRows', rows);
    const list = section.createDiv({ cls: 'kos-board-lines' });
    for (const row of rowPage.items) {
      const line = list.createDiv({ cls: 'kos-board-line' });
      const left = line.createDiv({ cls: 'kos-board-line-main' });
      this.pill(left, TYPE_LABELS[row.object.type].replace('输入源', '输入'), 'outline');
      this.link(left, objectName(row.object), () => void this.openFile(row.object.filePath));
      left.createSpan({ cls: `kos-board-state is-${tone(row.state)}`, text: `● ${labelState(row.state)}` });
      if ('area' in row.object && row.object.area) left.createSpan({ cls: 'kos-board-muted', text: row.object.area });
      const right = line.createDiv({ cls: 'kos-board-line-meta' });
      if (row.object.type === 'method') right.createSpan({ text: `验证 ${row.object.validated_times} 次` });
      else right.createSpan({ text: row.updated ?? '未记录' });
    }
    this.pagination(section, 'knowledgeRows', rowPage, 'knowledge', 'kos-knowledge-objects');
    const foot = section.createDiv({ cls: 'kos-board-footer' });
    foot.createSpan({ text: '增长曲线位于趋势抽屉' });
    foot.createSpan({ text: `成熟度分数 ${maturity.total || '—'}` });
  }

  private renderReview(section: HTMLElement): void {
    const objects = this.ctx.index.getAll();
    const questions = this.ctx.pendingQuestions?.() ?? [];
    const pending = pendingReviewRows(objects);
    const head = this.sectionHeader(section, '审阅', 'REVIEW');
    const tabs = head.createDiv({ cls: 'kos-board-tabs' });
    for (const label of ['待审阅', '周期复盘', '趋势']) tabs.createEl('button', { cls: label === '待审阅' ? 'is-active' : '', text: label });
    if (questions.length) {
      const question = questions[0];
      const card = section.createDiv({ cls: 'kos-board-question-card' });
      card.createDiv({ cls: 'kos-board-question-label', text: '● AGENT 提问 · 等待回答' });
      card.createEl('h3', { text: question.title ?? 'Agent 正在等待你的判断' });
      card.createDiv({ cls: 'kos-board-card-copy', text: question.message ?? question.placeholder ?? '请在 Agent 侧栏中回答。' });
      const actions = card.createDiv({ cls: 'kos-board-actions' });
      this.button(actions, '回答问题', true, () => void this.ctx.openAgent?.());
      this.button(actions, '转自由输入', false, () => void this.ctx.openAgent?.());
    }
    this.subhead(section, '待审阅', 'kos-review-queue');
    if (!pending.length) this.empty(section, '待审队列已清空');
    else {
      const reviewPage = this.page('reviewRows', pending);
      for (const object of reviewPage.items) this.renderReviewCard(section, object);
      this.pagination(section, 'reviewRows', reviewPage, 'review', 'kos-review-queue');
    }
    const foot = section.createDiv({ cls: 'kos-board-footer' });
    foot.createSpan({ text: `队列 ${pending.length} · 置顶提问 ${questions.length}` });
    foot.createSpan({ text: '更新 今天' });
  }

  private renderReviewCard(parent: HTMLElement, object: KosObject): void {
    const card = parent.createDiv({ cls: 'kos-board-review-card' });
    const top = card.createDiv({ cls: 'kos-board-card-top' });
    const title = top.createDiv({ cls: 'kos-board-card-title' });
    this.pill(title, TYPE_LABELS[object.type].replace('输入源', '输入'), 'outline');
    title.createSpan({ cls: 'kos-board-muted', text: `${object.type} · ${labelState(objectState(object) ?? 'pending')}` });
    this.link(title, objectTitle(object), () => void this.openFile(object.filePath));
    this.pill(top, '待审阅', 'warning');
    card.createDiv({ cls: 'kos-board-card-copy', text: `${TYPE_LABELS[object.type]}需要确认内容、证据与状态边界。` });
    const quote = card.createDiv({ cls: 'kos-board-agent-quote' });
    quote.createSpan({ cls: 'kos-board-dashed-label', text: 'AGENT 生成 · 待人审阅' });
    quote.createDiv({ text: '打开原文件查看完整内容与来源证据。' });
    const bottom = card.createDiv({ cls: 'kos-board-card-bottom' });
    const actions = bottom.createDiv({ cls: 'kos-board-actions' });
    this.button(actions, '通过', true, () => void this.ctx.approve?.(object));
    this.button(actions, '退回 AGENT', false, () => this.runAgent('review', 'review-object', [object], object.filePath));
    this.button(actions, '打开', false, () => void this.openFile(object.filePath));
    bottom.createSpan({ cls: 'kos-board-muted', text: `${TYPE_LABELS[object.type]} 必须逐项审阅` });
  }

  private renderSystem(section: HTMLElement): void {
    const head = this.sectionHeader(section, '系统', 'SYSTEM');
    head.createDiv({ cls: 'kos-board-head-note kos-board-mono', text: this.validation ? `检查于 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '尚未检查' });
    this.subhead(section, '系统健康', 'kos-system-findings');
    const errors = this.validation?.errorCount ?? 0;
    const warnings = this.validation?.warningCount ?? 0;
    const score = this.validation ? Math.max(0, 100 - errors * 20 - warnings * 5) : null;
    const health = section.createDiv({ cls: 'kos-board-health' });
    this.inlineStat(health, score ?? '—', '健康分', 'display');
    this.inlineStat(health, this.validation ? errors : '—', '错误', errors ? 'danger' : 'muted');
    this.inlineStat(health, this.validation ? warnings : '—', '警告', warnings ? 'warning' : 'muted');
    const findings = section.createDiv({ cls: 'kos-board-findings' });
    const findingRows = this.validation?.findings ?? [];
    const findingPage = this.page('systemFindings', findingRows);
    if (!this.validation) findings.createDiv({ cls: 'kos-board-finding', text: '尚未运行检查 · 点击底部“重新检查”获取确定性结果' });
    else if (!findingRows.length) findings.createDiv({ cls: 'kos-board-finding is-success', text: '通过 · 没有发现问题' });
    else for (const finding of findingPage.items) {
      const row = findings.createDiv({ cls: 'kos-board-finding' });
      this.pill(row, finding.level === 'ERROR' ? '错误' : finding.level === 'WARN' ? '警告' : '信息', finding.level === 'ERROR' ? 'danger' : 'warning');
      row.createSpan({ cls: 'kos-board-mono', text: finding.validator });
      row.createSpan({ text: finding.message });
      row.createDiv({ cls: 'kos-board-muted', text: `${finding.path || '全局'}　交给 AGENT 修复` });
    }
    if (findingRows.length) this.pagination(section, 'systemFindings', findingPage, 'system', 'kos-system-findings');
    this.subhead(section, 'AGENT 运行状态');
    const status = section.createDiv({ cls: 'kos-board-agent-status' });
    status.createSpan({ cls: this.agentSnapshot ? 'is-success' : 'is-warning', text: `● ${this.agentSnapshot ? (this.agentSnapshot.state.isStreaming ? '运行中' : '在线') : '未读取'}` });
    status.createSpan({ cls: 'kos-board-mono', text: 'KOS-AGENT' });
    const table = section.createDiv({ cls: 'kos-board-system-table' });
    this.systemRow(table, '版本', '0.2.0');
    this.systemRow(table, 'PROVIDER', this.agentSnapshot?.state.model?.provider ?? '—');
    this.systemRow(table, 'MODEL', this.agentSnapshot?.state.model?.id ?? '—');
    this.systemRow(table, 'NODE', typeof process !== 'undefined' ? process.versions.node : '—');
    this.systemRow(table, 'WEB SEARCH', this.agentSnapshot ? (this.agentSnapshot.webSearch.brave || this.agentSnapshot.webSearch.exa ? '已配置' : '未配置') : '—', this.agentSnapshot?.webSearch.brave || this.agentSnapshot?.webSearch.exa ? 'success' : 'neutral');
    this.systemRow(table, '活跃会话', this.agentSnapshot ? '1' : '—');
    const usage = this.agentSnapshot?.stats.contextUsage?.percent ?? null;
    const usageHead = section.createDiv({ cls: 'kos-board-usage-head' });
    usageHead.createSpan({ text: '上下文用量' });
    usageHead.createSpan({ cls: 'kos-board-mono', text: usage === null ? '—' : `${Math.round(usage)}%` });
    this.segmentRail(section, usage === null ? null : usage / 100, 32);
    this.subhead(section, 'SKILL 与 EVAL');
    section.createDiv({ cls: 'kos-board-skill-line', text: 'core —　 integrations —　 personal —　 incubator —　 eval 覆盖 —' });
    const foot = section.createDiv({ cls: 'kos-board-footer' });
    foot.createSpan({ text: '失败项 —（未读取）' });
    const actions = foot.createDiv({ cls: 'kos-board-actions' });
    this.button(actions, this.systemLoading ? '[LOADING]' : '刷新状态', false, () => void this.loadSystemStatus());
    this.button(actions, this.systemLoading ? '[LOADING]' : '重新检查', false, () => void this.runValidation());
  }

  private renderTaskLine(parent: HTMLElement, task: TaskObject, today: string): void {
    const line = parent.createDiv({ cls: 'kos-board-line kos-board-task-line' });
    const check = line.createEl('button', { cls: 'kos-board-check', attr: { 'aria-label': task.status === 'done' ? '已完成' : '标记完成' } });
    setIcon(check, task.status === 'done' ? 'square-check-big' : 'square');
    check.disabled = task.status !== 'doing' || !legalTransitions(task).some((target) => target.to === 'done');
    check.addEventListener('click', () => void this.ctx.transition?.(task, 'done'));
    const main = line.createDiv({ cls: 'kos-board-line-main' });
    this.pill(main, task.priority ?? 'P4', task.priority === 'P0' ? 'solid' : 'outline');
    this.link(main, objectName(task), () => void this.openFile(task.filePath));
    const meta = line.createDiv({ cls: 'kos-board-line-meta' });
    meta.createSpan({ text: task.project?.replace(/\[|\]/g, '') ?? '未关联项目' });
    if (taskIsOverdue(task, today)) meta.createSpan({ cls: 'is-danger', text: '逾期' });
    if (task.status === 'blocked') meta.createSpan({ cls: 'is-danger', text: '● 受阻' });
    else meta.createSpan({ text: `● ${labelState(task.status)}` });
    meta.createSpan({ cls: taskIsDueToday(task, today) ? 'is-warning' : '', text: taskIsDueToday(task, today) ? '今天' : task.due ?? '未排期' });
    if (task.status === 'blocked') this.button(meta, 'AGENT 分析阻塞', false, () => this.runAgent('action', 'resolve-blocker', [task], task.filePath));
  }

  private renderSourceLine(parent: HTMLElement, source: SourceObject): void {
    const line = parent.createDiv({ cls: 'kos-board-line' });
    line.createSpan({ cls: 'kos-board-check-static' });
    const main = line.createDiv({ cls: 'kos-board-line-main' });
    this.link(main, objectName(source), () => void this.ctx.openReader?.(source.filePath));
    const meta = line.createDiv({ cls: 'kos-board-line-meta' });
    if (source.format) this.pill(meta, source.format, 'outline');
    if (source.importance) this.pill(meta, source.importance === 'high' ? '高' : source.importance === 'medium' ? '中' : '低', 'outline');
    meta.createSpan({ text: `● ${labelState(source.status)}` });
    meta.createSpan({ text: source.author || '作者未记录' });
    meta.createSpan({ text: source.created ?? '未记录' });
    if (!['archived', 'ignored'].includes(source.status)) this.button(meta, SOURCE_ACTION[source.status], false, () => this.runAgent('input', 'process-sources', [source], source.filePath));
    const reader = meta.createEl('button', { cls: 'kos-board-icon', attr: { 'aria-label': '在 Reader 中阅读', title: '在 Reader 中阅读' } });
    setIcon(reader, 'book-open');
    reader.addEventListener('click', () => void this.ctx.openReader?.(source.filePath));
  }

  private runAgent(module: DashboardModule, intent: string, objects: KosObject[] = [], path?: string): void {
    if (!this.ctx.runAgent || this.agentRunning) return;
    this.agentRunning = true;
    this.render();
    void this.ctx.runAgent(module, intent, objects, path).catch((error) => {
      this.agentRunning = false;
      this.render();
      new Notice(error instanceof Error ? error.message : String(error));
    });
  }

  private async loadSystemStatus(): Promise<void> {
    if (!this.ctx.getAgentSnapshot || this.systemLoading) return;
    this.systemLoading = true; this.render();
    try { this.agentSnapshot = await this.ctx.getAgentSnapshot(); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
    finally { this.systemLoading = false; this.render(); this.setModule('system'); }
  }

  private async runValidation(): Promise<void> {
    if (!this.ctx.validate || this.systemLoading) return;
    this.systemLoading = true; this.render();
    try {
      this.validation = await this.ctx.validate();
      if (!this.agentSnapshot && this.ctx.getAgentSnapshot) this.agentSnapshot = await this.ctx.getAgentSnapshot();
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
    finally { this.systemLoading = false; this.render(); this.setModule('system'); }
  }

  private sectionHeader(parent: HTMLElement, label: string, code: string): HTMLElement {
    const head = parent.createDiv({ cls: 'kos-board-section-head' });
    head.createDiv({ cls: 'kos-board-section-title', text: `${label} · ${code}` });
    return head;
  }

  private subhead(parent: HTMLElement, text: string, id?: string): HTMLElement {
    const head = parent.createDiv({ cls: 'kos-board-subhead', attr: id ? { id } : undefined });
    head.createSpan({ text });
    return head;
  }

  private pill(parent: HTMLElement, text: string, variant: string): void { parent.createSpan({ cls: `kos-board-pill is-${variant}`, text }); }
  private link(parent: HTMLElement, text: string, action: () => void): void {
    const button = parent.createEl('button', { cls: 'kos-board-link', text });
    button.addEventListener('click', action);
  }
  private button(parent: HTMLElement, text: string, primary: boolean, action: () => void): HTMLButtonElement {
    const button = parent.createEl('button', { cls: `kos-board-button${primary ? ' is-primary' : ''}`, text });
    button.addEventListener('click', action);
    return button;
  }
  private page<T>(key: PaginationKey, items: T[]): PageSlice<T> {
    const result = paginate(items, this.pages[key]);
    this.pages[key] = result.page;
    return result;
  }
  private pagination<T>(
    parent: HTMLElement,
    key: PaginationKey,
    page: PageSlice<T>,
    module: DashboardModule,
    anchorId: string,
  ): void {
    if (page.totalPages <= 1) return;
    const nav = parent.createDiv({ cls: 'kos-board-pagination', attr: { 'aria-label': '分页' } });
    nav.createSpan({ cls: 'kos-board-pagination-label', text: `${page.start}–${page.end} / ${page.totalItems} · ${page.page}/${page.totalPages}` });
    const controls = nav.createDiv({ cls: 'kos-board-pagination-controls' });
    const previous = controls.createEl('button', { cls: 'kos-board-page-button', attr: { 'aria-label': '上一页', title: '上一页' } });
    setIcon(previous, 'chevron-left');
    previous.disabled = page.page === 1;
    previous.addEventListener('click', () => this.changePage(key, page.page - 1, module, anchorId));
    const next = controls.createEl('button', { cls: 'kos-board-page-button', attr: { 'aria-label': '下一页', title: '下一页' } });
    setIcon(next, 'chevron-right');
    next.disabled = page.page === page.totalPages;
    next.addEventListener('click', () => this.changePage(key, page.page + 1, module, anchorId));
  }
  private changePage(key: PaginationKey, page: number, module: DashboardModule, anchorId: string): void {
    this.pages[key] = page;
    this.render();
    window.requestAnimationFrame(() => {
      const target = this.contentEl.querySelector<HTMLElement>(`#${anchorId}`);
      if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
      else this.setModule(module);
    });
  }
  private anchorButton(parent: HTMLElement, text: string, active: boolean, id: string): void {
    const button = parent.createEl('button', { cls: active ? 'is-active' : '', text });
    button.addEventListener('click', () => this.contentEl.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView({ behavior: 'auto', block: 'start' }));
  }
  private attention(parent: HTMLElement, value: number, label: string, toneName: string): void {
    const stat = parent.createDiv({ cls: `kos-board-attention-stat is-${toneName}` });
    stat.createDiv({ cls: 'kos-board-attention-value', text: String(value) });
    stat.createDiv({ text: label });
  }
  private inlineStat(parent: HTMLElement, value: string | number, label: string, toneName = 'neutral'): void {
    const stat = parent.createDiv({ cls: `kos-board-inline-stat is-${toneName}` });
    stat.createDiv({ cls: 'kos-board-inline-value', text: String(value) });
    stat.createDiv({ text: label });
  }
  private segmentRail(parent: HTMLElement, ratio: number | null, count: number): void {
    const rail = parent.createDiv({ cls: 'kos-board-segment-rail' });
    for (let index = 0; index < count; index += 1) rail.createSpan({ cls: ratio !== null && index < Math.round(ratio * count) ? 'is-on' : '' });
  }
  private systemRow(parent: HTMLElement, key: string, value: string, toneName = 'neutral'): void {
    const row = parent.createDiv({ cls: 'kos-board-system-row' });
    row.createSpan({ cls: 'kos-board-mono', text: key });
    row.createSpan({ cls: `is-${toneName}`, text: value });
  }
  private empty(parent: HTMLElement, text: string, actionText?: string, action?: () => void): void {
    const empty = parent.createDiv({ cls: 'kos-board-empty' });
    empty.createSpan({ text });
    if (actionText && action) this.button(empty, actionText, false, action);
  }
  private todayLabel(): string { return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date()); }
}
