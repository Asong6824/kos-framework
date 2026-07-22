/**
 * metrics.ts — 全部指标计算（M1–M15）
 *
 * 口径唯一标准：docs/03_指标定义.md。函数名与指标编号一一对应。
 * 通用约定要点：
 * - 日期一律 YYYY-MM-DD 字符串比较，只认 frontmatter（created/completed/date/due）；
 * - 存活口径排除 archived/cancelled/deprecated/ignored；累计口径含已归档；
 * - streak 端点：当天无活动不死，以昨天为端点；当天有活动即续上；
 * - 补落快照（estimated）仅用于曲线展示，不参与环比/差分判定。
 */

import type { KosObject, KosObjectType, ProjectObject, TaskObject } from './model';
import {
  addDays,
  addMonths,
  backfillActivity,
  buildSnapshot,
  dateRange,
  daysBetween,
  diffPipeline,
  snapshotBacklog,
  startOfMonth,
  startOfWeek,
} from './snapshot';
import type { DailySnapshot } from './snapshot';

/** 指标相关设置项（对齐 02 文档第 5 节） */
export interface MetricSettings {
  /** 周起始日，0=周日 1=周一，默认 1 */
  weekStart?: number;
  /** 项目停滞预警天数，默认 3 */
  staleThresholdDays?: number;
  /** 热力图是否计入日记，默认 true */
  heatmapIncludeDiary?: boolean;
}

// ---------------------------------------------------------------------------
// M1 知识资产总数（存活口径）
// ---------------------------------------------------------------------------

export interface KnowledgeAssetTotal {
  total: number;
  concept: number;
  method: number;
  research: number;
}

/** M1：concept 全状态 + method(排除 deprecated) + research(排除 archived) */
export function knowledgeAssetTotal(objects: KosObject[]): KnowledgeAssetTotal {
  let concept = 0;
  let method = 0;
  let research = 0;
  for (const o of objects) {
    if (o.type === 'concept') {
      concept += 1; // concept 无 archived，全状态计入
    } else if (o.type === 'method' && o.status !== 'deprecated') {
      method += 1;
    } else if (o.type === 'research' && o.status !== 'archived') {
      research += 1;
    }
  }
  return { total: concept + method + research, concept, method, research };
}

// ---------------------------------------------------------------------------
// M2 本周 / 本月新增（累计口径）
// ---------------------------------------------------------------------------

export interface IntervalNewCount {
  start: string;
  end: string;
  byType: Partial<Record<KosObjectType, number>>;
  total: number;
  prevStart: string;
  prevEnd: string;
  prevTotal: number;
  delta: number;
  /** 上期为 0 时为 null（只显示绝对值，不显示百分比） */
  pct: number | null;
}

/** 统计 created ∈ [start, end] 的对象数（累计口径，含已归档，按类型分列） */
function countCreatedIn(objects: KosObject[], start: string, end: string): IntervalNewCount['byType'] & {
  total: number;
} {
  const byType: Partial<Record<KosObjectType, number>> = {};
  let total = 0;
  for (const o of objects) {
    if (o.created && o.created >= start && o.created <= end) {
      byType[o.type] = (byType[o.type] ?? 0) + 1;
      total += 1;
    }
  }
  return Object.assign(byType, { total }) as IntervalNewCount['byType'] & { total: number };
}

/** 单区间新增 + 与上一等长区间的环比 */
function intervalNew(objects: KosObject[], start: string, end: string): IntervalNewCount {
  const len = daysBetween(start, end) + 1;
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(len - 1));
  const cur = countCreatedIn(objects, start, end);
  const prev = countCreatedIn(objects, prevStart, prevEnd);
  const { total, ...byType } = cur;
  const delta = total - prev.total;
  return {
    start,
    end,
    byType,
    total,
    prevStart,
    prevEnd,
    prevTotal: prev.total,
    delta,
    pct: prev.total > 0 ? delta / prev.total : null,
  };
}

export interface NewAdditions {
  week: IntervalNewCount;
  month: IntervalNewCount;
}

/** M2：本周（周起始日可配，默认周一）与本月新增，含环比 */
export function newAdditions(objects: KosObject[], today: string, settings?: MetricSettings): NewAdditions {
  const weekStart = settings?.weekStart ?? 1;
  return {
    week: intervalNew(objects, startOfWeek(today, weekStart), today),
    month: intervalNew(objects, startOfMonth(today), today),
  };
}

// ---------------------------------------------------------------------------
// M3 知识复利曲线（累计口径）
// ---------------------------------------------------------------------------

export interface CompoundPoint {
  date: string;
  /** concept+method+research 按 created 的日累计和 */
  knowledge: number;
  /** source 累计（对照线） */
  source: number;
}

/** M3：自最早 created 至今的日累计折线；安装前历史由 created 回填，无需快照 */
export function compoundCurve(objects: KosObject[], today: string): CompoundPoint[] {
  let earliest: string | null = null;
  const knowledgeCreates = new Map<string, number>();
  const sourceCreates = new Map<string, number>();
  for (const o of objects) {
    if (!o.created) continue;
    if (earliest === null || o.created < earliest) earliest = o.created;
    if (o.type === 'concept' || o.type === 'method' || o.type === 'research') {
      knowledgeCreates.set(o.created, (knowledgeCreates.get(o.created) ?? 0) + 1);
    } else if (o.type === 'source') {
      sourceCreates.set(o.created, (sourceCreates.get(o.created) ?? 0) + 1);
    }
  }
  if (earliest === null) return [];

  const points: CompoundPoint[] = [];
  let knowledge = 0;
  let source = 0;
  for (const date of dateRange(earliest, today)) {
    knowledge += knowledgeCreates.get(date) ?? 0;
    source += sourceCreates.get(date) ?? 0;
    points.push({ date, knowledge, source });
  }
  return points;
}

// ---------------------------------------------------------------------------
// M4 今日进度环
// ---------------------------------------------------------------------------

export interface TaskRing {
  /** 今日 completed 的 task 数 */
  done: number;
  /** 分母 = done + due ≤ 今日且 status ∈ {todo, doing} 的 task 数 */
  total: number;
  /** 分母为 0 时为 null（只显示完成数，不显示比率） */
  ratio: number | null;
}

export interface InputRing {
  /**
   * 今日处理的 source 数（快照差分）。
   * 昨日快照缺失或为补落（estimated）时为 null —— 差分不可信，不显示。
   */
  processed: number | null;
  /** 目标值 = 昨日快照积压数 */
  target: number;
  /** target 为 0 或 processed 不可知时为 null（显示"无积压"） */
  ratio: number | null;
}

export interface TodayProgress {
  task: TaskRing;
  input: InputRing;
}

/** M4：任务环与输入环，数据源互不混用 */
export function todayProgress(objects: KosObject[], snapshots: DailySnapshot[], today: string): TodayProgress {
  let done = 0;
  let dueOpen = 0;
  for (const o of objects) {
    if (o.type !== 'task') continue;
    if (o.completed === today) done += 1;
    if ((o.status === 'todo' || o.status === 'doing') && o.due !== null && o.due <= today) dueOpen += 1;
  }
  const total = done + dueOpen;
  const task: TaskRing = { done, total, ratio: total > 0 ? done / total : null };

  const todaySnap = buildSnapshot(objects, today);
  const yesterday = snapshots.find((s) => s.date === addDays(today, -1));
  let input: InputRing;
  if (yesterday && !yesterday.estimated) {
    const diff = diffPipeline(yesterday, todaySnap);
    input = {
      processed: diff.processed,
      target: diff.target,
      ratio: diff.target > 0 ? diff.processed / diff.target : null,
    };
  } else {
    input = { processed: null, target: 0, ratio: null };
  }
  return { task, input };
}

// ---------------------------------------------------------------------------
// M5 活动热力图
// ---------------------------------------------------------------------------

/**
 * M5：每日 dayScore 全量历史（created/completed/日记 date 回填）。
 * ignored source 的创建计入；已删除对象以当前 vault 为准自然不计。
 */
export function activityHeatmap(objects: KosObject[], settings?: MetricSettings): Record<string, number> {
  return backfillActivity(objects, { includeDiary: settings?.heatmapIncludeDiary ?? true });
}

/** M5 分档：0 / 1–2 / 3–5 / 6–9 / ≥10 → 色阶 0–4 */
export function heatLevel(score: number): 0 | 1 | 2 | 3 | 4 {
  if (score <= 0) return 0;
  if (score <= 2) return 1;
  if (score <= 5) return 2;
  if (score <= 9) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// M6 活跃 Streak
// ---------------------------------------------------------------------------

export interface StreakResult {
  /** 当前连续活跃天数（端点规则：今天无活动则以昨天为端点） */
  current: number;
  /** 历史最长连续活跃天数 */
  longest: number;
}

/** M6：连续 dayScore > 0 的天数；补写日记按其 date 计入 */
export function activityStreak(objects: KosObject[], today: string, settings?: MetricSettings): StreakResult {
  const map = activityHeatmap(objects, settings);
  const dates = Object.keys(map).filter((d) => map[d] > 0 && d <= today);
  if (dates.length === 0) return { current: 0, longest: 0 };

  const active = new Set(dates);
  const first = dates.reduce((a, b) => (a < b ? a : b));

  // 当前 streak：今天有活动从今天起数，否则从昨天起数（端点规则）
  let current = 0;
  const endpoint = active.has(today) ? today : addDays(today, -1);
  for (let d = endpoint; active.has(d); d = addDays(d, -1)) current += 1;

  // 最长 streak：自最早活跃日逐日扫描
  let longest = 0;
  let run = 0;
  for (const d of dateRange(first, today)) {
    run = active.has(d) ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return { current, longest };
}

// ---------------------------------------------------------------------------
// M7 输入管道漏斗
// ---------------------------------------------------------------------------

export interface StageRate {
  from: string;
  to: string;
  /** 下一级 / 本级；分母为 0 时为 null（显示 —） */
  rate: number | null;
}

export interface PipelineFunnel {
  stages: {
    captured: number;
    extracted: number;
    summarized: number;
    reviewed: number;
    linked: number;
    /** 已完结（合并展示，不进漏斗主线） */
    archived: number;
    /** 单列，不进漏斗 */
    ignored: number;
  };
  /** 积压 = captured + extracted + summarized（存活口径） */
  backlog: number;
  /** 整体转化率 = (reviewed+linked+archived)/(全部 source − ignored)；分母 0 → null */
  conversion: number | null;
  stageRates: StageRate[];
}

/** M7：漏斗各级计数、积压、整体与各级转化率 */
export function pipelineFunnel(objects: KosObject[]): PipelineFunnel {
  const stages = { captured: 0, extracted: 0, summarized: 0, reviewed: 0, linked: 0, archived: 0, ignored: 0 };
  for (const o of objects) {
    if (o.type === 'source') stages[o.status] += 1;
  }
  const chain = ['captured', 'extracted', 'summarized', 'reviewed', 'linked'] as const;
  const totalNonIgnored = chain.reduce((s, k) => s + stages[k], 0) + stages.archived;
  const finished = stages.reviewed + stages.linked + stages.archived;
  return {
    stages,
    backlog: stages.captured + stages.extracted + stages.summarized,
    conversion: totalNonIgnored > 0 ? finished / totalNonIgnored : null,
    stageRates: chain.slice(0, -1).map((from, i) => {
      const to = chain[i + 1];
      return { from, to, rate: stages[from] > 0 ? stages[to] / stages[from] : null };
    }),
  };
}

// ---------------------------------------------------------------------------
// M8 知识成熟度分数
// ---------------------------------------------------------------------------

/** 成熟度里程碑步长（03 文档未定义"整数里程碑"的具体步长，取 100） */
export const MATURITY_MILESTONE_STEP = 100;

const CONCEPT_WEIGHT = { draft: 1, verified: 2, mature: 3 } as const;
const METHOD_WEIGHT = { candidate: 1, usable: 2, trusted: 3, deprecated: 0 } as const;
const RESEARCH_WEIGHT = { draft: 1, reviewed: 2, complete: 3, archived: 0 } as const;

export interface MaturityScore {
  total: number;
  concept: number;
  method: number;
  research: number;
  /** 下一整数里程碑 */
  nextMilestone: number;
  /** 距下一里程碑还差的分值 */
  toNext: number;
}

/** M8：不归一化、不设上限，随积累与审核单调上涨 */
export function maturityScore(objects: KosObject[]): MaturityScore {
  let concept = 0;
  let method = 0;
  let research = 0;
  for (const o of objects) {
    if (o.type === 'concept') concept += CONCEPT_WEIGHT[o.status];
    else if (o.type === 'method') method += METHOD_WEIGHT[o.status];
    else if (o.type === 'research') research += RESEARCH_WEIGHT[o.status];
  }
  const total = concept + method + research;
  const nextMilestone = (Math.floor(total / MATURITY_MILESTONE_STEP) + 1) * MATURITY_MILESTONE_STEP;
  return { total, concept, method, research, nextMilestone, toNext: nextMilestone - total };
}

// ---------------------------------------------------------------------------
// M9 待审核中心计数
// ---------------------------------------------------------------------------

export interface PendingReviewCount {
  total: number;
  byType: Partial<Record<KosObjectType, number>>;
}

/** M9 单对象判定：是否处于待审核状态（pendingReviewCount/List 共用同一口径） */
export function isPendingReview(o: KosObject): boolean {
  switch (o.type) {
    case 'summary':
      return !o.reviewed;
    case 'extract':
      return o.review_status === 'pending';
    case 'research':
    case 'concept':
    case 'personal_operating_profile':
      return o.status === 'draft';
    case 'reflection':
      return o.status === 'raw';
    case 'method':
      return o.status === 'candidate';
    default:
      return false;
  }
}

/** M9：待审核对象清单（B3 审核中心用；与 pendingReviewCount 同一判定口径） */
export function pendingReviewList(objects: KosObject[]): KosObject[] {
  return objects.filter(isPendingReview);
}

/** M9：各类型待审核对象计数（清零时触发 M13 review-clear） */
export function pendingReviewCount(objects: KosObject[]): PendingReviewCount {
  const byType: Partial<Record<KosObjectType, number>> = {};
  for (const o of objects) {
    if (isPendingReview(o)) byType[o.type] = (byType[o.type] ?? 0) + 1;
  }
  const total = Object.values(byType).reduce((s, n) => s + (n ?? 0), 0);
  return { total, byType };
}

// ---------------------------------------------------------------------------
// M10 项目推进度与停滞
// ---------------------------------------------------------------------------

export interface ProjectProgress {
  filePath: string;
  title: string;
  /** 全部任务数（32_任务 中 project 指向该项目的 task；项目页 checkbox 由数据层合并） */
  total: number;
  done: number;
  /** 无任务时为 null（显示 —） */
  progress: number | null;
  /** status=active 且 今天−updated ≥ staleThresholdDays；updated 缺失时为 null（不判定，提示补全） */
  stale: boolean | null;
  daysSinceUpdate: number | null;
}

/** wikilink 归一化：去 [[]]、去 |别名、取路径末段、去 .md */
export function wikilinkTarget(link: string): string {
  let s = link.trim();
  if (s.startsWith('[[') && s.endsWith(']]')) s = s.slice(2, -2);
  const pipe = s.indexOf('|');
  if (pipe >= 0) s = s.slice(0, pipe);
  const slash = s.lastIndexOf('/');
  if (slash >= 0) s = s.slice(slash + 1);
  if (s.endsWith('.md')) s = s.slice(0, -3);
  return s.trim();
}

/** 项目对象的标识名：title 优先，退化为文件名 */
function projectKey(p: ProjectObject): string {
  if (p.title) return p.title;
  const base = p.filePath.slice(p.filePath.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
}

/** task 是否属于某项目 */
function taskBelongsTo(t: TaskObject, key: string): boolean {
  const projects = t.projects ?? (t.project ? [t.project] : []);
  return projects.some((project) => wikilinkTarget(project) === key);
}

/** M10：逐项目推进度 + 停滞判定 */
export function projectProgress(objects: KosObject[], today: string, settings?: MetricSettings): ProjectProgress[] {
  const threshold = settings?.staleThresholdDays ?? 3;
  const tasks = objects.filter((o): o is TaskObject => o.type === 'task');
  const out: ProjectProgress[] = [];
  for (const o of objects) {
    if (o.type !== 'project') continue;
    const key = projectKey(o);
    const mine = tasks.filter((t) => taskBelongsTo(t, key));
    const done = mine.filter((t) => t.status === 'done').length;
    const daysSinceUpdate = o.updated !== null ? daysBetween(o.updated, today) : null;
    out.push({
      filePath: o.filePath,
      title: key,
      total: mine.length,
      done,
      progress: mine.length > 0 ? done / mine.length : null,
      // updated 缺失 → null 不判定；否则仅 active 项目可能停滞
      stale: daysSinceUpdate !== null ? o.status === 'active' && daysSinceUpdate >= threshold : null,
      daysSinceUpdate,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// M11 心情 / 精力趋势
// ---------------------------------------------------------------------------

export interface WeekEnergy {
  /** 周起始日 */
  weekStart: string;
  /** 该周日记 energy 均值；全部缺失时为 null */
  avgEnergy: number | null;
  /** 参与均值的日记数 */
  energyCount: number;
  /** 该周 M5 dayScore 的日均（一周按 7 天计） */
  avgDayScore: number;
}

export interface MoodEnergyTrend {
  weeks: WeekEnergy[];
  /** mood 自由字符串词频 */
  moods: Record<string, number>;
  /** energy 缺失或非整数而被跳过的日记数（提示用户补全） */
  skippedEnergy: number;
}

/** M11：energy 按周均值 + mood 词频 + 周日均 dayScore 叠加 */
export function moodEnergyTrend(objects: KosObject[], settings?: MetricSettings): MoodEnergyTrend {
  const weekStartDay = settings?.weekStart ?? 1;
  const activity = activityHeatmap(objects, settings);

  const byWeek = new Map<string, { energySum: number; energyCount: number; scoreSum: number }>();
  const moods: Record<string, number> = {};
  let skippedEnergy = 0;

  for (const o of objects) {
    if (o.type !== 'diary' || o.date === null) continue;
    const ws = startOfWeek(o.date, weekStartDay);
    let bucket = byWeek.get(ws);
    if (!bucket) {
      bucket = { energySum: 0, energyCount: 0, scoreSum: 0 };
      byWeek.set(ws, bucket);
    }
    if (o.energy !== null) {
      bucket.energySum += o.energy;
      bucket.energyCount += 1;
    } else {
      skippedEnergy += 1;
    }
    if (o.mood) moods[o.mood] = (moods[o.mood] ?? 0) + 1;
  }

  const weeks: WeekEnergy[] = [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([ws, b]) => {
      const scoreSum = dateRange(ws, addDays(ws, 6)).reduce((s, d) => s + (activity[d] ?? 0), 0);
      return {
        weekStart: ws,
        avgEnergy: b.energyCount > 0 ? b.energySum / b.energyCount : null,
        energyCount: b.energyCount,
        avgDayScore: scoreSum / 7,
      };
    });
  return { weeks, moods, skippedEnergy };
}

// ---------------------------------------------------------------------------
// M12 系统健康分
// ---------------------------------------------------------------------------

export interface HealthReportInput {
  /** 6 个 validator 合并后的 error 总数 */
  errors: number;
  /** 6 个 validator 合并后的 warning 总数 */
  warnings: number;
}

export interface SystemHealth {
  score: number;
  errors: number;
  warnings: number;
}

/** M12：100 起扣，error −5、warning −2，下限 0 */
export function systemHealth(report: HealthReportInput): SystemHealth {
  return {
    score: Math.max(0, 100 - 5 * report.errors - 2 * report.warnings),
    errors: report.errors,
    warnings: report.warnings,
  };
}

// ---------------------------------------------------------------------------
// M13 徽章清单
// ---------------------------------------------------------------------------

export const BADGE_IDS = [
  'first-concept',
  'concept-50',
  'concept-100',
  'first-mature',
  'summary-100',
  'streak-7',
  'streak-30',
  'streak-100',
  'diary-30',
  'task-100',
  'method-trusted',
  'method-validated-10',
  'project-complete',
  'inbox-zero',
  'review-clear',
] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

/** 可重复徽章（记录次数，如 inboxZeroCount） */
export const REPEATABLE_BADGES: readonly BadgeId[] = ['inbox-zero', 'review-clear'];

export interface BadgeEvalInput {
  objects: KosObject[];
  /** M6 当前 streak */
  currentStreak: number;
  /** 10_收件箱 当前文件数（非 kos 对象，由数据层统计传入） */
  inboxFileCount: number;
  /** 上一次观察到的收件箱文件数；undefined 表示首次观察 */
  prevInboxFileCount?: number;
  /** 当前 M9 待审核数 */
  pendingReview: number;
  /** 上一次观察到的 M9 数；undefined 表示首次观察 */
  prevPendingReview?: number;
}

/** M13：评估当前达成全部条件的徽章 id 列表（含可重复徽章的再触发） */
export function evaluateBadges(input: BadgeEvalInput): BadgeId[] {
  const { objects, currentStreak } = input;
  const earned: BadgeId[] = [];

  let conceptAlive = 0;
  let conceptMature = 0;
  let summaryTotal = 0;
  let diaryTotal = 0;
  let taskCompleted = 0;
  let methodTrusted = 0;
  let validatedSum = 0;
  let projectCompleted = 0;
  for (const o of objects) {
    switch (o.type) {
      case 'concept':
        conceptAlive += 1; // concept 无 archived，全状态即存活
        if (o.status === 'mature') conceptMature += 1;
        break;
      case 'summary':
        summaryTotal += 1; // 累计口径
        break;
      case 'diary':
        diaryTotal += 1;
        break;
      case 'task':
        if (o.completed !== null) taskCompleted += 1;
        break;
      case 'method':
        if (o.status === 'trusted') methodTrusted += 1;
        validatedSum += o.validated_times;
        break;
      case 'project':
        if (o.status === 'completed') projectCompleted += 1;
        break;
      default:
        break;
    }
  }

  if (conceptAlive >= 1) earned.push('first-concept');
  if (conceptAlive >= 50) earned.push('concept-50');
  if (conceptAlive >= 100) earned.push('concept-100');
  if (conceptMature >= 1) earned.push('first-mature');
  if (summaryTotal >= 100) earned.push('summary-100');
  if (currentStreak >= 7) earned.push('streak-7');
  if (currentStreak >= 30) earned.push('streak-30');
  if (currentStreak >= 100) earned.push('streak-100');
  if (diaryTotal >= 30) earned.push('diary-30');
  if (taskCompleted >= 100) earned.push('task-100');
  if (methodTrusted >= 1) earned.push('method-trusted');
  if (validatedSum >= 10) earned.push('method-validated-10');
  if (projectCompleted >= 1) earned.push('project-complete');

  // 可重复：首次观察到 0，或从非零回到 0
  if (input.inboxFileCount === 0 && (input.prevInboxFileCount === undefined || input.prevInboxFileCount > 0)) {
    earned.push('inbox-zero');
  }
  if (input.pendingReview === 0 && (input.prevPendingReview === undefined || input.prevPendingReview > 0)) {
    earned.push('review-clear');
  }
  return earned;
}

/**
 * M13：与已解锁集合求差，返回本次新解锁的徽章 id。
 * 不可重复徽章已解锁则过滤；可重复徽章每次达成条件都算"新解锁"（由调用方累加次数）。
 */
export function newBadges(earned: BadgeId[], unlocked: Record<string, string | null>): BadgeId[] {
  return earned.filter((id) => {
    if (REPEATABLE_BADGES.includes(id)) return true;
    return !(id in unlocked);
  });
}

// ---------------------------------------------------------------------------
// M14 周报 / 月报（环比字段表）
// ---------------------------------------------------------------------------

export interface PeriodReportExtras {
  /** M9 清零次数（来自 data.json，core 无法推算） */
  reviewClearCount?: number;
  /** 本周期新解锁徽章（来自 M13 求差结果） */
  newBadges?: string[];
}

export interface PeriodReport {
  period: 'week' | 'month';
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  /** M2 各类型新增（本周期） */
  newByType: Partial<Record<KosObjectType, number>>;
  newTotal: number;
  prevNewTotal: number;
  newDelta: number;
  /** 上期为 0 时为 null */
  newPct: number | null;
  /** M4 任务完成总数（按 completed 字段，前后周期均从对象推算） */
  tasksCompleted: number;
  prevTasksCompleted: number;
  /** M7 整体转化率（当前 vs 对比快照） */
  conversion: number | null;
  prevConversion: number | null;
  /** M7 积压（当前 vs 对比快照） */
  backlog: number;
  prevBacklog: number | null;
  /** M8 分数与增量（对比快照缺失/补落时增量为 null） */
  maturity: number;
  prevMaturity: number | null;
  maturityDelta: number | null;
  /** M9 当前待审核数 */
  pendingReview: number;
  /** M6 当前 streak */
  streakCurrent: number;
  /** 对比快照缺失（插件未运行） */
  prevSnapshotMissing: boolean;
  /** 对比快照为补落（estimated，不参与环比，通用约定 6） */
  prevSnapshotEstimated: boolean;
  reviewClearCount?: number;
  newBadges?: string[];
}

/** 快照中的管道转化率（口径同 M7） */
function snapshotConversion(snap: DailySnapshot): number | null {
  const p = snap.pipeline;
  const totalNonIgnored = p.captured + p.extracted + p.summarized + p.reviewed + p.linked + p.archived;
  return totalNonIgnored > 0 ? (p.reviewed + p.linked + p.archived) / totalNonIgnored : null;
}

function countCompletedIn(objects: KosObject[], start: string, end: string): number {
  return objects.filter((o) => o.type === 'task' && o.completed !== null && o.completed >= start && o.completed <= end)
    .length;
}

/** M14：周/月报环比字段表；对比点为"上周期同位置"的快照 */
export function periodReport(
  objects: KosObject[],
  snapshots: DailySnapshot[],
  today: string,
  period: 'week' | 'month',
  settings?: MetricSettings,
  extras?: PeriodReportExtras,
): PeriodReport {
  const start = period === 'week' ? startOfWeek(today, settings?.weekStart ?? 1) : startOfMonth(today);
  const len = daysBetween(start, today) + 1;
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(len - 1));

  const cur = intervalNew(objects, start, today);
  const funnel = pipelineFunnel(objects);
  const maturity = maturityScore(objects);

  // 对比快照：上周期同位置（周报 = 7 天前，月报 = 一个月前）
  const compareDate = period === 'week' ? addDays(today, -7) : addMonths(today, -1);
  const prevSnap = snapshots.find((s) => s.date === compareDate);
  const prevUsable = prevSnap !== undefined && !prevSnap.estimated;

  const report: PeriodReport = {
    period,
    start,
    end: today,
    prevStart,
    prevEnd,
    newByType: cur.byType,
    newTotal: cur.total,
    prevNewTotal: cur.prevTotal,
    newDelta: cur.delta,
    newPct: cur.pct,
    tasksCompleted: countCompletedIn(objects, start, today),
    prevTasksCompleted: countCompletedIn(objects, prevStart, prevEnd),
    conversion: funnel.conversion,
    prevConversion: prevUsable ? snapshotConversion(prevSnap) : null,
    backlog: funnel.backlog,
    prevBacklog: prevUsable ? snapshotBacklog(prevSnap) : null,
    maturity: maturity.total,
    prevMaturity: prevUsable ? prevSnap.maturityScore : null,
    maturityDelta: prevUsable ? maturity.total - prevSnap.maturityScore : null,
    pendingReview: pendingReviewCount(objects).total,
    streakCurrent: activityStreak(objects, today, settings).current,
    prevSnapshotMissing: prevSnap === undefined,
    prevSnapshotEstimated: prevSnap !== undefined && prevSnap.estimated === true,
  };
  if (extras?.reviewClearCount !== undefined) report.reviewClearCount = extras.reviewClearCount;
  if (extras?.newBadges !== undefined) report.newBadges = extras.newBadges;
  return report;
}

/** M14 周报快捷入口 */
export function weeklyReport(
  objects: KosObject[],
  snapshots: DailySnapshot[],
  today: string,
  settings?: MetricSettings,
  extras?: PeriodReportExtras,
): PeriodReport {
  return periodReport(objects, snapshots, today, 'week', settings, extras);
}

/** M14 月报快捷入口 */
export function monthlyReport(
  objects: KosObject[],
  snapshots: DailySnapshot[],
  today: string,
  settings?: MetricSettings,
  extras?: PeriodReportExtras,
): PeriodReport {
  return periodReport(objects, snapshots, today, 'month', settings, extras);
}

// ---------------------------------------------------------------------------
// M15 年 / 月 / 周 / 日时间进度
// ---------------------------------------------------------------------------

export type ProgressPeriod = 'year' | 'month' | 'week' | 'day';

export interface YearProgressSnapshot {
  year: number;
  dayOfYear: number;
  daysInYear: number;
  progress: Record<ProgressPeriod, number>;
}

function clampTimeProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function elapsedPeriod(now: Date, start: Date, end: Date): number {
  return clampTimeProgress((now.getTime() - start.getTime()) / (end.getTime() - start.getTime()));
}

/** M15：按设备本地时区计算当前时刻在年、月、周（周一开始）和日中的已流逝比例。 */
export function yearProgressSnapshot(now: Date): YearProgressSnapshot {
  const year = now.getFullYear();
  const month = now.getMonth();
  const date = now.getDate();
  const dayStart = new Date(year, month, date);
  const nextDay = new Date(year, month, date + 1);
  const mondayOffset = (now.getDay() + 6) % 7;
  const weekStart = new Date(year, month, date - mondayOffset);
  const nextWeek = new Date(year, month, date - mondayOffset + 7);
  const yearStartUtc = Date.UTC(year, 0, 1);
  const todayUtc = Date.UTC(year, month, date);
  const nextYearUtc = Date.UTC(year + 1, 0, 1);
  return {
    year,
    dayOfYear: Math.floor((todayUtc - yearStartUtc) / 86_400_000) + 1,
    daysInYear: Math.round((nextYearUtc - yearStartUtc) / 86_400_000),
    progress: {
      year: elapsedPeriod(now, new Date(year, 0, 1), new Date(year + 1, 0, 1)),
      month: elapsedPeriod(now, new Date(year, month, 1), new Date(year, month + 1, 1)),
      week: elapsedPeriod(now, weekStart, nextWeek),
      day: elapsedPeriod(now, dayStart, nextDay),
    },
  };
}
