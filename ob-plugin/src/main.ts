import { Notice, Plugin } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { openCaptureModal } from './actions/capture';
import { createTodayDiary, openCreateModal } from './actions/create';
import { BadgeWatcher } from './actions/badges';
import { openReportModal } from './actions/report';
import type { ReportDeps } from './actions/report';
import { approveReviewObject } from './actions/review';
import { openTransitionModal, statusBadgeProcessor } from './actions/transition';
import { isHarnessAvailable, runHealthCheck } from './bridge/harness';
import { pendingReviewCount, projectProgress } from './core/metrics';
import type { KosObject } from './core/model';
import { buildSnapshot } from './core/snapshot';
import { KosIndex } from './data/index';
import { KosDataStore, localToday } from './data/store';
import { DEFAULT_SETTINGS, KosSettingTab, toMetricSettings } from './settings';
import type { KosSettings } from './settings';
import { DashboardView, DASHBOARD_VIEW_TYPE } from './views/dashboard-view';
import { HeatmapView, HEATMAP_VIEW_TYPE } from './views/heatmap-view';
import { ReviewView, REVIEW_VIEW_TYPE } from './views/review-view';
import { TasksView, TASKS_VIEW_TYPE } from './views/tasks-view';
import { KosView } from './views/view-context';
import type { ViewContext } from './views/view-context';

/** 各视图的打开位置：驾驶舱中央 tab，其余右侧栏 */
const VIEW_LOCATIONS: Record<string, 'tab' | 'right'> = {
  [DASHBOARD_VIEW_TYPE]: 'tab',
  [HEATMAP_VIEW_TYPE]: 'right',
  [REVIEW_VIEW_TYPE]: 'right',
  [TASKS_VIEW_TYPE]: 'right',
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

    // 阅读模式状态徽章（B4：类型 + 当前状态 + 下一状态按钮组）
    this.registerMarkdownPostProcessor(statusBadgeProcessor(this.app, () => this.settings));

    // 视图命令
    this.addCommand({
      id: 'open-dashboard',
      name: '打开驾驶舱',
      callback: () => void this.activateView(DASHBOARD_VIEW_TYPE),
    });
    this.addCommand({
      id: 'open-heatmap',
      name: '打开活动热力图',
      callback: () => void this.activateView(HEATMAP_VIEW_TYPE),
    });
    this.addCommand({
      id: 'open-review',
      name: '打开待审核中心',
      callback: () => void this.activateView(REVIEW_VIEW_TYPE),
    });
    this.addCommand({
      id: 'open-tasks',
      name: '打开聚合任务',
      callback: () => void this.activateView(TASKS_VIEW_TYPE),
    });

    // B1 快速捕获（全局命令，不强制热键）+ ribbon
    this.addCommand({
      id: 'quick-capture',
      name: '快速捕获到收件箱',
      callback: () => openCaptureModal(this.app, this.settings.objectDirs),
    });
    this.addRibbonIcon('pencil', '快速捕获到收件箱', () => openCaptureModal(this.app, this.settings.objectDirs));

    // B4 状态流转
    this.addCommand({
      id: 'transition-current-file',
      name: '流转当前文件状态',
      callback: () => openTransitionModal(this.app, this.settings),
    });

    // B5 创建向导
    this.addCommand({ id: 'create-project', name: '新建项目', callback: () => openCreateModal(this.app, 'project', this.settings.objectDirs) });
    this.addCommand({ id: 'create-concept', name: '新建概念', callback: () => openCreateModal(this.app, 'concept', this.settings.objectDirs) });
    this.addCommand({ id: 'create-method', name: '新建方法', callback: () => openCreateModal(this.app, 'method', this.settings.objectDirs) });
    this.addCommand({ id: 'create-task', name: '新建任务', callback: () => openCreateModal(this.app, 'task', this.settings.objectDirs) });
    this.addCommand({ id: 'create-source', name: '新建输入源', callback: () => openCreateModal(this.app, 'source', this.settings.objectDirs) });
    this.addCommand({ id: 'create-diary', name: '创建今日日记', callback: () => void createTodayDiary(this.app, this.settings.objectDirs) });

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
    if (isHarnessAvailable()) {
      this.addCommand({
        id: 'health-check',
        name: '运行系统健康检查',
        callback: () => runHealthCheck(this.app, this.settings),
      });
    }

    this.addRibbonIcon('gauge', '打开 kos 驾驶舱', () => void this.activateView(DASHBOARD_VIEW_TYPE));

    // C2 状态栏：待审核数（M9）+ 停滞项目数（M10）
    this.pendingStatusEl = this.addStatusBarItem();
    this.pendingStatusEl.addClass('kos-status-item');
    this.pendingStatusEl.addEventListener('click', () => void this.activateView(REVIEW_VIEW_TYPE));
    this.staleStatusEl = this.addStatusBarItem();
    this.staleStatusEl.addClass('kos-status-item');
    this.staleStatusEl.addEventListener('click', () => void this.activateView(TASKS_VIEW_TYPE));
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
    for (const type of Object.keys(VIEW_LOCATIONS)) {
      this.app.workspace.detachLeavesOfType(type);
    }
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
    };
  }

  /** 报告命令注入上下文 */
  private reportDeps(): ReportDeps {
    return {
      index: this.index,
      store: this.store,
      metricSettings: () => toMetricSettings(this.settings),
      objectDirs: () => this.settings.objectDirs,
    };
  }

  /** B3 审核"通过"回调：按状态机走到下一个已确认态（actions/review.ts） */
  private readonly onApprove = (obj: KosObject): void => {
    void approveReviewObject(this.app, obj, this.settings);
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
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null | undefined = workspace.getLeavesOfType(viewType)[0];
    if (!leaf) {
      leaf = VIEW_LOCATIONS[viewType] === 'tab' ? workspace.getLeaf('tab') : workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: viewType, active: true });
    }
    await workspace.revealLeaf(leaf);
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
