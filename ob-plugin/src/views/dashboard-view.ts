/**
 * dashboard-view.ts — A1 总览驾驶舱（含 A4 漏斗、A5 成熟度、A8 心情趋势）
 *
 * 布局：顶部工具条 → KPI 卡片行 → 主区两列网格（左：复利曲线大卡 + 心情卡；
 * 右：今日进度 + 输入管道漏斗）→ 底部成熟度分布通栏卡。
 * 视图只做渲染：指标一律调 core/metrics。
 */

import { setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import {
  activityStreak,
  compoundCurve,
  knowledgeAssetTotal,
  maturityScore,
  moodEnergyTrend,
  newAdditions,
  pendingReviewCount,
  pipelineFunnel,
  todayProgress,
} from '../core/metrics';
import type { IntervalNewCount } from '../core/metrics';
import type { KosObjectType } from '../core/model';
import { compoundChart, funnelChart, progressRing, sparkline, stackedBar } from './components';
import type { FunnelStage } from './components';
import { KosView, TYPE_LABELS } from './view-context';
import type { ViewContext } from './view-context';

export const DASHBOARD_VIEW_TYPE = 'kos-dashboard';

/** M7 漏斗各级中文名（顺序对齐 captured→linked 主流转链） */
const FUNNEL_STAGE_LABELS: Array<[key: 'captured' | 'extracted' | 'summarized' | 'reviewed' | 'linked', label: string]> =
  [
    ['captured', '已捕获'],
    ['extracted', '已摘录'],
    ['summarized', '已摘要'],
    ['reviewed', '已审核'],
    ['linked', '已链接'],
  ];

/** 环比文案：+N (+X%)；上期为 0（pct null）时只显示绝对值（M2 口径） */
function deltaText(c: IntervalNewCount): string {
  const sign = c.delta >= 0 ? '+' : '';
  if (c.pct === null) return `${sign}${c.delta}`;
  return `${sign}${c.delta} (${sign}${Math.round(c.pct * 100)}%)`;
}

/** 环比元素：正绿 ↑、负红 ↓、零 muted（无语义色时为纯文本） */
function deltaEl(parent: HTMLElement, c: IntervalNewCount): void {
  const cls = c.delta > 0 ? 'kos-delta-up' : c.delta < 0 ? 'kos-delta-down' : 'kos-delta-flat';
  const arrow = c.delta > 0 ? '↑ ' : c.delta < 0 ? '↓ ' : '';
  parent.createSpan({ cls, text: `${arrow}${deltaText(c)}` });
}

/** 按类型分列文案：只列出有新增的类型 */
function byTypeText(byType: Partial<Record<KosObjectType, number>>): string {
  const parts = (Object.entries(byType) as Array<[KosObjectType, number]>)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${TYPE_LABELS[t]} ${n}`);
  return parts.length > 0 ? parts.join(' · ') : '暂无新增';
}

export class DashboardView extends KosView {
  constructor(leaf: WorkspaceLeaf, ctx: ViewContext) {
    super(leaf, ctx);
  }

  getViewType(): string {
    return DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'kos 驾驶舱';
  }

  getIcon(): string {
    return 'gauge';
  }

  /** KPI 卡片：上小标签、中大数字、底部一行小注 */
  private kpi(grid: HTMLElement, label: string, value: string | number, foot?: (el: HTMLElement) => void): HTMLElement {
    const card = grid.createDiv({ cls: 'kos-kpi' });
    card.createDiv({ cls: 'kos-kpi-label', text: label });
    card.createDiv({ cls: 'kos-kpi-value', text: String(value) });
    const footEl = card.createDiv({ cls: 'kos-kpi-foot' });
    foot?.(footEl);
    return card;
  }

  /** 卡片容器：顶部小标题 + 内容区 */
  private card(parent: HTMLElement, title: string): HTMLElement {
    const card = parent.createDiv({ cls: 'kos-card' });
    card.createDiv({ cls: 'kos-card-title', text: title });
    return card;
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('kos-view', 'kos-dashboard');

    const objects = this.ctx.index.getAll();
    const today = this.today();
    const ms = this.ctx.metricSettings();
    const snapshots = this.ctx.store.snapshotList();

    // 指标一次算齐（全部来自 core）
    const assets = knowledgeAssetTotal(objects);
    const additions = newAdditions(objects, today, ms);
    const curve = compoundCurve(objects, today);
    const progress = todayProgress(objects, snapshots, today);
    const funnel = pipelineFunnel(objects);
    const maturity = maturityScore(objects);
    const pending = pendingReviewCount(objects);
    const streak = activityStreak(objects, today, ms);
    const trend = moodEnergyTrend(objects, ms);

    // ---------- 顶部工具条 ----------
    const toolbar = contentEl.createDiv({ cls: 'kos-toolbar' });
    toolbar.createSpan({ cls: 'kos-toolbar-title', text: 'kos 驾驶舱' });
    const side = toolbar.createDiv({ cls: 'kos-toolbar-side' });
    side.createSpan({ cls: 'kos-refresh-time', text: `上次刷新 ${new Date().toLocaleTimeString()}` });
    const refreshBtn = side.createEl('button', { cls: 'kos-icon-button', attr: { 'aria-label': '刷新' } });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => this.render());
    if (this.ctx.openAgent) {
      const agentBtn = side.createEl('button', { cls: 'kos-icon-button', attr: { 'aria-label': '在 Agent 中分析工作台' } });
      setIcon(agentBtn, 'message-square');
      agentBtn.addEventListener('click', () => void this.ctx.openAgent?.('00_工作台/今日工作台.md', '分析当前工作台并建议下一步行动'));
    }

    // ---------- KPI 卡片行 ----------
    const kpiGrid = contentEl.createDiv({ cls: 'kos-kpi-grid' });
    this.kpi(kpiGrid, '知识资产总计', assets.total, (f) => {
      f.createSpan({ cls: 'kos-muted', text: `概念 ${assets.concept} · 方法 ${assets.method} · 研究 ${assets.research}` });
    });
    const weekCard = this.kpi(kpiGrid, '本周新增', additions.week.total, (f) => deltaEl(f, additions.week));
    // 近 14 天增长 sparkline（全平 → 基准线 + 空态文案）
    const sparkWrap = weekCard.createDiv({ cls: 'kos-kpi-spark' });
    const hasTrend = sparkline(
      sparkWrap,
      curve.slice(-14).map((p) => ({ date: p.date, value: p.knowledge })),
      { emptyText: '近 14 天无新增' },
    );
    if (hasTrend) sparkWrap.createDiv({ cls: 'kos-muted', text: '近 14 天知识资产累计' });
    this.kpi(kpiGrid, '本月新增', additions.month.total, (f) => {
      deltaEl(f, additions.month);
      f.createSpan({ cls: 'kos-muted', text: ` ${byTypeText(additions.month.byType)}` });
    });
    this.kpi(kpiGrid, '待审核', pending.total, (f) => {
      f.createSpan({ cls: 'kos-muted', text: pending.total > 0 ? '审核中心有待办' : '已清零 🎉' });
    });
    this.kpi(kpiGrid, '成熟度分', maturity.total, (f) => {
      f.createSpan({ cls: 'kos-muted', text: `距里程碑 ${maturity.nextMilestone} 还差 ${maturity.toNext}` });
    });
    this.kpi(kpiGrid, '当前 streak', `${streak.current} 天`, (f) => {
      f.createSpan({ cls: 'kos-muted', text: `历史最长 ${streak.longest} 天` });
    });

    // ---------- 主区两列网格 ----------
    const grid = contentEl.createDiv({ cls: 'kos-dash-grid' });
    const colLeft = grid.createDiv({ cls: 'kos-dash-col' });
    const colRight = grid.createDiv({ cls: 'kos-dash-col' });

    // M3 知识复利曲线（左列大卡）
    const curveCard = this.card(colLeft, '知识复利曲线');
    compoundChart(curveCard, curve);
    curveCard.createDiv({
      cls: 'kos-card-foot kos-muted',
      text: `本周新增 ${additions.week.total}，环比 ${deltaText(additions.week)}`,
    });

    // M11 心情 / 精力趋势（左列，A8）
    const moodCard = this.card(colLeft, '心情 / 精力趋势');
    const energyWeeks = trend.weeks.filter((w) => w.avgEnergy !== null);
    const moodTop = Object.entries(trend.moods)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (energyWeeks.length === 0 && moodTop.length === 0) {
      moodCard.createDiv({ cls: 'kos-empty', text: '暂无日记数据，写几篇日记后这里会出现趋势' });
    } else {
      if (energyWeeks.length > 0) {
        const wrap = moodCard.createDiv({ cls: 'kos-sparkline-wrap' });
        const hasEnergy = sparkline(
          wrap,
          energyWeeks.slice(-12).map((w) => ({ date: w.weekStart, value: w.avgEnergy ?? 0 })),
          { emptyText: '近 12 周精力无波动' },
        );
        if (hasEnergy) wrap.createDiv({ cls: 'kos-muted', text: '近 12 周精力均值（energy）' });
      }
      if (moodTop.length > 0) {
        const row = moodCard.createDiv({ cls: 'kos-mood-row' });
        for (const [mood, n] of moodTop) row.createSpan({ cls: 'kos-tag', text: `${mood} ×${n}` });
      }
      if (trend.skippedEnergy > 0) {
        moodCard.createDiv({ cls: 'kos-card-foot kos-muted', text: `${trend.skippedEnergy} 篇日记缺 energy 字段，已跳过` });
      }
    }

    // M4 今日双进度环（右列；分母降级规则见 03 文档）
    const todayCard = this.card(colRight, '今日进度');
    const todayRow = todayCard.createDiv({ cls: 'kos-today-row' });
    const taskItem = todayRow.createDiv({ cls: 'kos-today-item' });
    progressRing(taskItem, progress.task.ratio, '今日任务', String(progress.task.done));
    taskItem.createDiv({
      cls: 'kos-muted kos-today-note',
      text: progress.task.ratio === null ? '无到期任务' : `${progress.task.done} / ${progress.task.total}`,
    });
    const inputItem = todayRow.createDiv({ cls: 'kos-today-item' });
    progressRing(inputItem, progress.input.ratio, '今日输入处理', progress.input.processed?.toString(), {
      tone: 'green',
    });
    inputItem.createDiv({
      cls: 'kos-muted kos-today-note',
      text:
        progress.input.processed === null
          ? '缺昨日快照'
          : progress.input.target === 0
            ? '无积压'
            : `${progress.input.processed} / ${progress.input.target}`,
    });

    // M7 输入管道漏斗（右列）
    const funnelCard = this.card(colRight, '输入管道漏斗');
    const stages: FunnelStage[] = FUNNEL_STAGE_LABELS.map(([key, label], i) => ({
      label,
      count: funnel.stages[key],
      rate: funnel.stageRates[i]?.rate ?? null,
    }));
    funnelChart(funnelCard, stages);
    funnelCard.createDiv({
      cls: 'kos-card-foot kos-muted',
      text:
        `积压 ${funnel.backlog} · 整体转化率 ` +
        `${funnel.conversion === null ? '—' : `${Math.round(funnel.conversion * 100)}%`}` +
        ` · 已完结 ${funnel.stages.archived} · 已忽略 ${funnel.stages.ignored}`,
    });

    // M8 成熟度分布（底部通栏卡：左堆叠条，右总分 + 里程碑）
    const maturityCard = this.card(contentEl, '知识成熟度分布');
    const maturityRow = maturityCard.createDiv({ cls: 'kos-maturity-row' });
    const barWrap = maturityRow.createDiv({ cls: 'kos-maturity-bar' });
    stackedBar(barWrap, [
      { label: '概念', value: maturity.concept },
      { label: '方法', value: maturity.method },
      { label: '研究', value: maturity.research },
    ]);
    const scoreWrap = maturityRow.createDiv({ cls: 'kos-maturity-score' });
    scoreWrap.createDiv({ cls: 'kos-kpi-value', text: String(maturity.total) });
    scoreWrap.createDiv({
      cls: 'kos-muted',
      text: `距下一里程碑 ${maturity.nextMilestone} 还差 ${maturity.toNext} 分`,
    });
  }
}
