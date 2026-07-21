import { Notice, Plugin, TFile } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { openCaptureModal } from './actions/capture';
import { openCreateModal } from './actions/create';
import type { CreateExtra, CreateKind, CreateObjectOperation } from './actions/create';
import { BadgeWatcher } from './actions/badges';
import { openReportModal } from './actions/report';
import type { ReportDeps } from './actions/report';
import { approveReviewObject } from './actions/review';
import { openTransitionModal, statusBadgeProcessor } from './actions/transition';
import { applyTransition } from './actions/transition';
import type { TransitionOperation } from './actions/transition';
import { createKosAgentClient, isKosAgentSupported } from './bridge/kos-agent';
import { runAgentValidation } from './bridge/agent-validation';
import type { KosAgentClient } from './agent/client';
import { pendingReviewCount, projectProgress } from './core/metrics';
import type { KosObject, ObjectDirs } from './core/model';
import { buildSnapshot } from './core/snapshot';
import { KosIndex } from './data/index';
import { KosDataStore, localToday } from './data/store';
import { DEFAULT_SETTINGS, KosSettingTab, toMetricSettings } from './settings';
import type { KosSettings } from './settings';
import { DashboardView, DASHBOARD_VIEW_TYPE } from './views/dashboard-view';
import { HeatmapView, HEATMAP_VIEW_TYPE } from './views/heatmap-view';
import { ReviewView, REVIEW_VIEW_TYPE } from './views/review-view';
import { TasksView, TASKS_VIEW_TYPE } from './views/tasks-view';
import { AgentView, AGENT_VIEW_TYPE } from './views/agent-view';
import { ReaderView, READER_VIEW_TYPE } from './views/reader-view';
import { ensureReaderSource as ensureReaderSourceAssociation } from './views/reader/association';
import { formatReaderAgentQuote } from './reader/model';
import type { ReaderExcerpt } from './reader/model';
import { KosView } from './views/view-context';
import type { ViewContext } from './views/view-context';
import type { DashboardModule } from './core/dashboard';

/** 各视图的打开位置：工作台与 Reader 在中央 tab，工具视图在右侧栏。 */
const VIEW_LOCATIONS: Record<string, 'tab' | 'right'> = {
  [DASHBOARD_VIEW_TYPE]: 'tab',
  [HEATMAP_VIEW_TYPE]: 'right',
  [REVIEW_VIEW_TYPE]: 'right',
  [TASKS_VIEW_TYPE]: 'right',
  [AGENT_VIEW_TYPE]: 'right',
  [READER_VIEW_TYPE]: 'tab',
};

/** 跨天检测间隔（02 文档第 4 节：本地日期变化时先落昨日终态再开新一天） */
const DAY_TICK_MS = 60_000;

export default class KosCompanionPlugin extends Plugin {
  settings: KosSettings = { ...DEFAULT_SETTINGS, objectDirs: { ...DEFAULT_SETTINGS.objectDirs } };
  index!: KosIndex;
  store!: KosDataStore;
  private badges!: BadgeWatcher;
  private pendingStatusEl: HTMLElement | null = null;
  private staleStatusEl: HTMLElement | null = null;
  private agentClient: KosAgentClient | null = null;
  private agentConnection: Promise<KosAgentClient> | null = null;
  private agentEventUnsubscribe: (() => void) | null = null;
  private viewActivation: Promise<void> = Promise.resolve();
  /** 当前计数的本地日期（跨天检测基准） */
  private currentDate = '';

  async onload(): Promise<void> {
    // 持久化：加载 data.json（含设置项，见 store.ts DataFile 说明）
    this.store = new KosDataStore(this);
    await this.store.load();
    this.settings = this.store.settings;

    // 索引：全量构建并开启增量监听（objectDirs getter 注入，设置变更即生效）
    this.index = new KosIndex(this.app, () => this.settings.objectDirs);
    await this.index.build();

    // 跨天：补落缺失日快照（estimated）+ 昨天终态落盘
    this.currentDate = localToday();
    this.store.ensureSnapshots(this.index.getAll(), this.currentDate);
    await this.store.save();

    // 视图注册（构造注入 ViewContext；审核中心注入真实 onApprove）
    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this.viewContext()));
    this.registerView(HEATMAP_VIEW_TYPE, (leaf) => new HeatmapView(leaf, this.viewContext()));
    this.registerView(REVIEW_VIEW_TYPE, (leaf) => new ReviewView(leaf, this.viewContext(), this.onApprove));
    this.registerView(TASKS_VIEW_TYPE, (leaf) => new TasksView(leaf, this.viewContext()));
    this.registerView(READER_VIEW_TYPE, (leaf) => new ReaderView(leaf, {
      backToInput: () => this.activateDashboardModule('input'),
      getProgress: (path) => this.store.getReaderProgress(path),
      saveProgress: async (path, progress) => {
        this.store.setReaderProgress(path, progress);
        await this.store.save();
      },
      ensureSource: (documentPath) => this.ensureReaderSource(documentPath),
      addToExtract: (excerpt) => this.addReaderExcerpt(excerpt),
      addToAgent: (excerpt) => this.addReaderExcerptToAgent(excerpt),
    }));
    this.registerExtensions(['epub'], READER_VIEW_TYPE);
    if (isKosAgentSupported(this.app)) {
      this.registerView(
        AGENT_VIEW_TYPE,
        (leaf) => new AgentView(leaf, {
          autoStart: () => this.settings.agentAutoStart,
          connect: () => this.connectAgent(),
        }),
      );
    }

    // 阅读模式状态徽章（B4：类型 + 当前状态 + 下一状态按钮组）
    if (isKosAgentSupported(this.app)) {
      this.registerMarkdownPostProcessor(
        statusBadgeProcessor(this.app, () => this.settings, this.agentTransitionOperation()!, (path) => void this.openAgentFrom(path)),
      );
    }

    // 视图命令
    this.addCommand({
      id: 'open-dashboard',
      name: '打开驾驶舱',
      callback: () => void this.activateDashboardModule('today'),
    });
    this.addCommand({ id: 'open-action', name: '打开行动模块', callback: () => void this.activateDashboardModule('action') });
    this.addCommand({ id: 'open-input', name: '打开输入模块', callback: () => void this.activateDashboardModule('input') });
    this.addCommand({ id: 'open-knowledge', name: '打开知识模块', callback: () => void this.activateDashboardModule('knowledge') });
    this.addCommand({ id: 'open-system', name: '打开系统模块', callback: () => void this.activateDashboardModule('system') });
    this.addCommand({
      id: 'open-heatmap',
      name: '打开活动热力图',
      callback: () => void this.activateView(HEATMAP_VIEW_TYPE),
    });
    this.addCommand({
      id: 'open-review',
      name: '打开待审核中心',
      callback: () => void this.activateDashboardModule('review'),
    });
    this.addCommand({
      id: 'open-tasks',
      name: '打开聚合任务',
      callback: () => void this.activateDashboardModule('action'),
    });
    this.addCommand({
      id: 'open-current-file-in-reader',
      name: '使用 kos Reader 打开当前文件',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const supported = file instanceof TFile && (file.extension === 'pdf' || file.extension === 'epub');
        if (supported && !checking) void this.openReaderDocument(file.path);
        return supported;
      },
    });
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || (file.extension !== 'pdf' && file.extension !== 'epub')) return;
      menu.addItem((item) => item
        .setTitle('使用 kos Reader 打开')
        .setIcon('book-open')
        .onClick(() => void this.openReaderDocument(file.path)));
    }));
    if (isKosAgentSupported(this.app)) {
      this.addCommand({
        id: 'open-agent',
        name: '打开 kos Agent',
        callback: () => void this.activateView(AGENT_VIEW_TYPE),
      });
    }

    // B1 快速捕获（全局命令，不强制热键）+ ribbon
    this.addCommand({
      id: 'quick-capture',
      name: '快速捕获到收件箱',
      callback: () => openCaptureModal(this.app, this.settings.objectDirs),
    });
    this.addRibbonIcon('pencil', '快速捕获到收件箱', () => openCaptureModal(this.app, this.settings.objectDirs));

    // B4 状态流转
    if (isKosAgentSupported(this.app)) {
      this.addCommand({
        id: 'transition-current-file',
        name: '流转当前文件状态',
        callback: () => openTransitionModal(this.app, this.settings, this.agentTransitionOperation()!),
      });

      // B5 创建向导
      this.addCommand({ id: 'create-project', name: '新建项目', callback: () => this.openCreate('project') });
      this.addCommand({ id: 'create-concept', name: '新建概念', callback: () => this.openCreate('concept') });
      this.addCommand({ id: 'create-method', name: '新建方法', callback: () => this.openCreate('method') });
      this.addCommand({ id: 'create-task', name: '新建任务', callback: () => this.openCreate('task') });
      this.addCommand({ id: 'create-source', name: '新建输入源', callback: () => this.openCreate('source') });
      this.addCommand({
        id: 'create-diary',
        name: '创建今日日记',
        callback: () => void this.connectAgent().then((client) => client.runDailyWorkflow('diary')).then((result) => {
          new Notice(`已生成：${result.path}`);
          return this.app.workspace.openLinkText(result.path, '', false);
        }),
      });
      this.addCommand({
        id: 'inline-edit-selection',
        name: '用 kos Agent 编辑当前选区',
        editorCallback: () => void this.openAgentForInlineEdit(),
      });
    }

    // A7 周报 / 月报（M14）
    this.addCommand({
      id: 'weekly-report',
      name: '生成本周周报',
      callback: () => openReportModal(this.app, this.reportDeps(), 'week'),
    });
    this.addCommand({
      id: 'monthly-report',
      name: '生成本月月报',
      callback: () => openReportModal(this.app, this.reportDeps(), 'month'),
    });

    // C1/D1 健康检查（仅桌面端 + Node 可用时注册，移动端无此命令）
    if (isKosAgentSupported(this.app)) {
      this.addCommand({
        id: 'health-check',
        name: '运行系统健康检查',
        callback: () => void this.connectAgent().then((client) => runAgentValidation(this.app, client)),
      });
    }

    this.addRibbonIcon('gauge', '打开 kos 驾驶舱', () => void this.activateDashboardModule('today'));
    if (isKosAgentSupported(this.app)) {
      this.addRibbonIcon('message-square', '打开 kos Agent', () => void this.activateView(AGENT_VIEW_TYPE));
    }

    // C2 状态栏：待审核数（M9）+ 停滞项目数（M10）
    this.pendingStatusEl = this.addStatusBarItem();
    this.pendingStatusEl.addClass('kos-status-item');
    this.pendingStatusEl.addEventListener('click', () => void this.activateDashboardModule('review'));
    this.staleStatusEl = this.addStatusBarItem();
    this.staleStatusEl.addClass('kos-status-item');
    this.staleStatusEl.addEventListener('click', () => void this.activateDashboardModule('action'));
    this.updateStatusBar();

    // 徽章系统（M13）：启动评估一次（非重复徽章补解锁），之后随索引变更评估
    this.badges = new BadgeWatcher(
      this.index,
      this.store,
      () => this.settings,
      () => toMetricSettings(this.settings),
    );
    void this.badges.check();

    // 索引变更 → 视图/状态栏刷新 + 当日快照覆盖 + 徽章检查（02 文档第 4 节事件流）
    this.index.onDidChange(() => void this.onIndexChanged());

    // 跨天检测：本地日期变化时落昨日终态快照（非 estimated），重置当日计数
    this.registerInterval(
      window.setInterval(() => {
        void this.onDayTick();
      }, DAY_TICK_MS),
    );

    this.addSettingTab(new KosSettingTab(this.app, this));
  }

  onunload(): void {
    this.index?.dispose();
    this.agentEventUnsubscribe?.();
    void this.agentClient?.stop();
    for (const type of Object.keys(VIEW_LOCATIONS)) {
      this.app.workspace.detachLeavesOfType(type);
    }
  }

  private connectAgent(): Promise<KosAgentClient> {
    if (this.agentClient?.isRunning) return Promise.resolve(this.agentClient);
    if (this.agentConnection) return this.agentConnection;

    const client = createKosAgentClient(this.app, this.settings);
    this.agentConnection = client.start()
      .then(() => {
        this.agentClient = client;
        this.agentEventUnsubscribe?.();
        this.agentEventUnsubscribe = client.onEvent((event) => {
          if (event.type === 'agent_start') this.setDashboardAgentRunning(true);
          if (event.type === 'agent_end' || event.type === 'agent_settled') this.setDashboardAgentRunning(false);
          if (event.type === 'extension_ui_request') this.refreshDashboard();
        });
        return client;
      })
      .catch(async (error) => {
        await client.stop();
        throw error;
      })
      .finally(() => {
        this.agentConnection = null;
      });
    return this.agentConnection;
  }

  private openCreate(kind: CreateKind): void {
    openCreateModal(this.app, kind, this.settings.objectDirs, this.agentCreateOperation()!);
  }

  private agentCreateOperation(): CreateObjectOperation | undefined {
    if (!isKosAgentSupported(this.app)) return undefined;
    return async (kind: CreateKind, title: string, dirs: ObjectDirs, extra: CreateExtra) => {
      const client = await this.connectAgent();
      const result = await client.createObject({
        kind,
        title,
        directories: {
          project: dirs.project,
          concept: dirs.concept,
          method: dirs.method,
          task: dirs.task,
          source: dirs.source,
        },
        extra,
      });
      new Notice(`已创建：${result.path}`);
      return result.path;
    };
  }

  private agentTransitionOperation(): TransitionOperation | undefined {
    if (!isKosAgentSupported(this.app)) return undefined;
    return async (path: string, target: string) => {
      const client = await this.connectAgent();
      const result = await client.transitionStatus({ path, target });
      new Notice(`已流转：${result.path} · ${result.from} → ${result.to}`);
      return true;
    };
  }

  /** 设置页保存入口：设置与指标数据同存 data.json，走 store 统一落盘 */
  async saveSettings(): Promise<void> {
    this.store.settings = this.settings;
    await this.store.save();
  }

  /** 视图注入上下文（settings 读取时求值，跟随设置变更） */
  private viewContext(): ViewContext {
    return {
      index: this.index,
      store: this.store,
      metricSettings: () => toMetricSettings(this.settings),
      openAgent: (path, prompt) => this.openAgentFrom(path, prompt),
      runAgent: (module, intent, objects, path) => this.runDashboardAgent(module, intent, objects, path),
      transition: (object, target) => this.transitionObject(object, target),
      approve: (object) => this.approveObject(object),
      create: (kind) => this.openCreate(kind),
      capture: () => openCaptureModal(this.app, this.settings.objectDirs),
      openReader: (path) => this.openReader(path),
      report: (period) => openReportModal(this.app, this.reportDeps(), period),
      getAgentSnapshot: async () => {
        const client = await this.connectAgent();
        const [state, stats, webSearch] = await Promise.all([
          client.getState(), client.getSessionStats(), client.getWebSearchState(),
        ]);
        return { state, stats, webSearch };
      },
      validate: async () => (await this.connectAgent()).validate(),
      pendingQuestions: () => this.agentClient?.getPendingQuestions() ?? [],
    };
  }

  private async runDashboardAgent(
    module: DashboardModule,
    intent: string,
    objects: KosObject[] = [],
    path?: string,
  ): Promise<void> {
    await this.activateView(AGENT_VIEW_TYPE);
    const view = this.app.workspace.getLeavesOfType(AGENT_VIEW_TYPE)[0]?.view;
    if (!(view instanceof AgentView)) throw new Error('kos Agent 视图不可用');
    const context = {
      module,
      view: module,
      filters: {},
      selectedObjects: objects.map((object) => ({ type: object.type, path: object.filePath, title: 'title' in object ? object.title ?? null : null })),
      activeFile: path ? { path } : null,
      intent,
    };
    const command = intent === 'prioritize-today'
      ? `/kos-start-my-day\n\n看板上下文：${JSON.stringify(context, null, 2)}`
      : intent === 'end-day'
        ? `/kos-end-my-day\n\n看板上下文：${JSON.stringify(context, null, 2)}`
        : `请执行看板意图 ${intent}。\n\n看板上下文：${JSON.stringify(context, null, 2)}`;
    await view.runConversation(path, command);
  }

  private async transitionObject(object: KosObject, target: string): Promise<boolean> {
    const operation = this.agentTransitionOperation();
    if (!operation) throw new Error('状态流转需要桌面端 kos-agent');
    return applyTransition(this.app, object, target, this.settings, operation);
  }

  private async approveObject(object: KosObject): Promise<boolean> {
    const operation = this.agentTransitionOperation();
    if (!operation) throw new Error('审核需要桌面端 kos-agent');
    return approveReviewObject(this.app, object, this.settings, operation);
  }

  private async openAgentFrom(path?: string, prompt?: string): Promise<void> {
    await this.activateView(AGENT_VIEW_TYPE);
    const view = this.app.workspace.getLeavesOfType(AGENT_VIEW_TYPE)[0]?.view;
    if (view instanceof AgentView) await view.beginConversation(path, prompt);
  }

  private async activateDashboardModule(module: DashboardModule): Promise<void> {
    await this.activateView(DASHBOARD_VIEW_TYPE);
    const view = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)[0]?.view;
    if (view instanceof DashboardView) view.setModule(module);
  }

  private async openReader(path: string): Promise<void> {
    await this.enqueueViewActivation(async () => {
      let leaf = this.app.workspace.getLeavesOfType(READER_VIEW_TYPE)[0];
      if (!leaf) leaf = this.app.workspace.getLeaf('tab');
      const view = leaf.view;
      if (view instanceof ReaderView) {
        await this.revealViewLeaf(leaf);
        await view.openSource(path);
      } else {
        await leaf.setViewState({ type: READER_VIEW_TYPE, active: true, state: { path } });
        await this.revealViewLeaf(leaf);
      }
    });
  }

  private async openReaderDocument(path: string): Promise<void> {
    await this.enqueueViewActivation(async () => {
      let leaf = this.app.workspace.getLeavesOfType(READER_VIEW_TYPE)[0];
      if (!leaf) leaf = this.app.workspace.getLeaf('tab');
      const view = leaf.view;
      if (view instanceof ReaderView) {
        await this.revealViewLeaf(leaf);
        await view.openDocument(path);
      } else {
        await leaf.setViewState({ type: READER_VIEW_TYPE, active: true, state: { file: path } });
        await this.revealViewLeaf(leaf);
      }
    });
  }

  private async ensureReaderSource(documentPath: string): Promise<string> {
    const association = await ensureReaderSourceAssociation(this.app, this.settings.objectDirs, documentPath);
    if (association.created) new Notice(`已创建 Source：${association.sourcePath}`);
    return association.sourcePath;
  }

  private async addReaderExcerpt(excerpt: ReaderExcerpt): Promise<void> {
    if (!isKosAgentSupported(this.app)) {
      new Notice('添加摘录需要 Obsidian 桌面端和 kos-agent');
      return;
    }
    try {
      const result = await (await this.connectAgent()).appendReaderExtract({
        sourcePath: excerpt.sourcePath,
        documentPath: excerpt.documentPath,
        kind: excerpt.kind,
        location: excerpt.selection.location,
        positionLabel: excerpt.selection.positionLabel,
        text: excerpt.selection.text,
        directories: {
          project: this.settings.objectDirs.project,
          concept: this.settings.objectDirs.concept,
          method: this.settings.objectDirs.method,
          task: this.settings.objectDirs.task,
          source: this.settings.objectDirs.source,
          extract: this.settings.objectDirs.extract,
          summary: this.settings.objectDirs.summary,
          research: this.settings.objectDirs.research,
          reflection: this.settings.objectDirs.reflection,
        },
      });
      new Notice(result.duplicate
        ? `该内容已在摘录中：${result.path}`
        : result.created ? `已创建摘录：${result.path}` : `已添加到摘录：${result.path}`);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  private async addReaderExcerptToAgent(excerpt: ReaderExcerpt): Promise<void> {
    if (!isKosAgentSupported(this.app)) {
      new Notice('添加到 Agent 需要 Obsidian 桌面端和 kos-agent');
      return;
    }
    try {
      await this.activateView(AGENT_VIEW_TYPE);
      const view = this.app.workspace.getLeavesOfType(AGENT_VIEW_TYPE)[0]?.view;
      if (!(view instanceof AgentView)) throw new Error('kos Agent 视图不可用');
      await view.beginConversation();
      view.insertDraft(formatReaderAgentQuote(excerpt));
      new Notice('已添加到 Agent 输入框');
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  private setDashboardAgentRunning(running: boolean): void {
    for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)) {
      if (leaf.view instanceof DashboardView) leaf.view.setAgentRunning(running);
    }
  }

  private refreshDashboard(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)) {
      if (leaf.view instanceof DashboardView) leaf.view.render();
    }
  }

  private async openAgentForInlineEdit(): Promise<void> {
    await this.activateView(AGENT_VIEW_TYPE);
    const view = this.app.workspace.getLeavesOfType(AGENT_VIEW_TYPE)[0]?.view;
    if (view instanceof AgentView) await view.beginInlineEdit();
  }

  /** 报告命令注入上下文 */
  private reportDeps(): ReportDeps {
    return {
      index: this.index,
      store: this.store,
      metricSettings: () => toMetricSettings(this.settings),
      ensureDiary: async (date: string) => {
        const client = await this.connectAgent();
        const result = await client.runDailyWorkflow('diary', date);
        const file = this.app.vault.getAbstractFileByPath(result.path);
        if (!(file instanceof TFile)) throw new Error(`kos-agent 未生成日记：${result.path}`);
        return file;
      },
    };
  }

  /** B3 审核"通过"回调：按状态机走到下一个已确认态（actions/review.ts） */
  private readonly onApprove = (obj: KosObject): void => {
    const operation = this.agentTransitionOperation();
    if (!operation) {
      new Notice('审核状态更新需要桌面端 kos-agent');
      return;
    }
    void approveReviewObject(this.app, obj, this.settings, operation).catch((error) =>
      new Notice(error instanceof Error ? error.message : String(error)),
    );
  };

  /** 索引变更后的统一动作：视图 + 状态栏 + 当日快照 + 徽章 */
  private async onIndexChanged(): Promise<void> {
    this.refreshViews();
    this.updateStatusBar();
    // 当日快照：每次变更覆盖当天（跨天时由 onDayTick 先落昨日终态）
    this.store.appendSnapshot(buildSnapshot(this.index.getAll(), localToday()));
    await this.badges.check();
    await this.store.save();
  }

  /** 跨天处理（02 文档第 4 节）：昨天终态落盘 → 开新一天计数 → 刷新视图 */
  private async onDayTick(): Promise<void> {
    const today = localToday();
    if (today === this.currentDate) return;
    const yesterday = this.currentDate;
    const objects = this.index.getAll();
    this.store.appendSnapshot(buildSnapshot(objects, yesterday)); // 昨日终态（非 estimated）
    this.currentDate = today;
    this.store.appendSnapshot(buildSnapshot(objects, today)); // 新一天起点（后续变更覆盖）
    await this.store.save();
    this.refreshViews();
    this.updateStatusBar();
    new Notice('新的一天，快照已切换');
  }

  /** 打开视图：复用已有 leaf；驾驶舱开中央 tab，其余开右侧栏 */
  async activateView(viewType: string): Promise<void> {
    await this.enqueueViewActivation(async () => {
      const { workspace } = this.app;
      let leaf: WorkspaceLeaf | null | undefined = workspace.getLeavesOfType(viewType)[0];
      if (!leaf) {
        leaf = VIEW_LOCATIONS[viewType] === 'tab' ? workspace.getLeaf('tab') : workspace.getRightLeaf(false);
        if (!leaf) return;
        await leaf.setViewState({ type: viewType, active: true });
      }
      await this.revealViewLeaf(leaf);
    });
  }

  private enqueueViewActivation(operation: () => Promise<void>): Promise<void> {
    const next = this.viewActivation.then(operation, operation);
    this.viewActivation = next.catch(() => undefined);
    return next;
  }

  private async revealViewLeaf(leaf: WorkspaceLeaf): Promise<void> {
    const { workspace } = this.app;
    workspace.setActiveLeaf(leaf, { focus: true });
    await workspace.revealLeaf(leaf);
    workspace.setActiveLeaf(leaf, { focus: true });
  }

  /** 通知所有已打开的 kos 视图重渲染 */
  refreshViews(): void {
    for (const type of Object.keys(VIEW_LOCATIONS)) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        if (leaf.view instanceof KosView) leaf.view.render();
      }
    }
  }

  /**
   * C2 状态栏：有待审核显示"待审 N"（点击开审核中心）；
   * active 项目有停滞追加"停滞 M"（点击开任务视图）；为 0 时隐藏对应项。
   */
  updateStatusBar(): void {
    const objects = this.index.getAll();
    const today = localToday();
    const ms = toMetricSettings(this.settings);
    const pending = pendingReviewCount(objects).total;
    const staleCount = projectProgress(objects, today, ms).filter((p) => p.stale === true).length;
    this.setStatusText(this.pendingStatusEl, pending > 0 ? `待审 ${pending}` : null);
    this.setStatusText(this.staleStatusEl, staleCount > 0 ? `停滞 ${staleCount}` : null);
  }

  private setStatusText(el: HTMLElement | null, text: string | null): void {
    if (!el) return;
    el.setText(text ?? '');
    el.style.display = text === null ? 'none' : '';
  }
}
