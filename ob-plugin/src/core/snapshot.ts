/**
 * snapshot.ts — 每日快照数据结构 + 历史活动回填 + 快照差分
 *
 * data.json schema 对齐 docs/02_技术方案.md 3.2 节。
 * 口径：docs/03_指标定义.md 通用约定（权威时间只认 frontmatter；
 * source 无 updated，"某日处理了多少"一律用相邻快照差分）。
 */

import { isTerminalStatus } from './model';
import type { KosObject, KosObjectType } from './model';
import { maturityScore, pendingReviewCount } from './metrics';

// ---------------------------------------------------------------------------
// 日期工具（全部按 UTC 日历日计算，避免本地时区夏令时误差）
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(v: unknown): v is string {
  return typeof v === 'string' && DATE_RE.test(v);
}

function toMs(date: string): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return Date.UTC(y, m - 1, d);
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** date + n 天，返回 YYYY-MM-DD */
export function addDays(date: string, n: number): string {
  return fromMs(toMs(date) + n * 86400000);
}

/** to − from 的天数（可负） */
export function daysBetween(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / 86400000);
}

/** date + n 个月（月度环比用），日号溢出时夹到月末 */
export function addMonths(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  const d = Number(date.slice(8, 10));
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return fromMs(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay)));
}

/** 所在周的起始日；weekStart 0=周日 1=周一（默认周一） */
export function startOfWeek(date: string, weekStart = 1): string {
  const dow = new Date(toMs(date)).getUTCDay();
  const diff = (dow - weekStart + 7) % 7;
  return addDays(date, -diff);
}

/** 所在月 1 日 */
export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** [start, end] 闭区间的日期序列；start > end 返回空 */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------------------------------------------------------------------------
// DailySnapshot（data.json 单日快照结构）
// ---------------------------------------------------------------------------

/** source 管道各状态计数（含 archived/ignored，供差分用） */
export interface SnapshotPipeline {
  captured: number;
  extracted: number;
  summarized: number;
  reviewed: number;
  linked: number;
  archived: number;
  ignored: number;
}

export interface DailySnapshot {
  /** 快照日期 YYYY-MM-DD */
  date: string;
  /** 各类型存活数（排除 archived/cancelled/deprecated/ignored；无状态对象全计） */
  totals: Partial<Record<KosObjectType, number>>;
  pipeline: SnapshotPipeline;
  /** M9 待审核数 */
  pendingReview: number;
  /** M8 成熟度分数 */
  maturityScore: number;
  /** 当日 completed 的 task 数 */
  tasksDoneToday: number;
  /** 当日 M5 dayScore */
  activityCount: number;
  /** 补落快照标记：仅用于曲线展示，不参与环比/差分判定（通用约定 6） */
  estimated?: boolean;
}

// ---------------------------------------------------------------------------
// 历史回填（M5/M6 的历史数据源）
// ---------------------------------------------------------------------------

export interface BackfillOptions {
  /** 热力图是否计入日记（对应 heatmapIncludeDiary，默认 true） */
  includeDiary?: boolean;
}

/**
 * 由 created/completed/日记 date 回填每日活动图。
 * dayScore = 当日创建对象数(全部类型) + 当日完成任务数 + 日记存在(0/1)。
 * 边界：ignored source 的创建仍计入；已删除对象不在入参中，自然不计。
 */
export function backfillActivity(
  objects: KosObject[],
  options?: BackfillOptions,
): Record<string, number> {
  const includeDiary = options?.includeDiary ?? true;
  const scores: Record<string, number> = {};
  const diaryDates = new Set<string>();

  for (const o of objects) {
    if (o.created) {
      scores[o.created] = (scores[o.created] ?? 0) + 1;
    }
    if (o.type === 'task' && o.completed) {
      scores[o.completed] = (scores[o.completed] ?? 0) + 1;
    }
    if (o.type === 'diary' && o.date) {
      diaryDates.add(o.date);
    }
  }
  if (includeDiary) {
    for (const d of diaryDates) {
      scores[d] = (scores[d] ?? 0) + 1;
    }
  }
  return scores;
}

// ---------------------------------------------------------------------------
// 快照构建与差分
// ---------------------------------------------------------------------------

/** 从当前对象集合构建当日快照 */
export function buildSnapshot(objects: KosObject[], today: string): DailySnapshot {
  const totals: Partial<Record<KosObjectType, number>> = {};
  const pipeline: SnapshotPipeline = {
    captured: 0,
    extracted: 0,
    summarized: 0,
    reviewed: 0,
    linked: 0,
    archived: 0,
    ignored: 0,
  };

  for (const o of objects) {
    // 存活口径：排除终态（diary/signal/dashboard 无状态机；extract/summary 无生命周期终态，全计）
    let alive = true;
    switch (o.type) {
      case 'diary':
      case 'signal':
      case 'dashboard':
      case 'extract':
      case 'summary':
        break;
      default:
        alive = !isTerminalStatus(o.status);
    }
    if (alive) {
      totals[o.type] = (totals[o.type] ?? 0) + 1;
    }
    if (o.type === 'source') {
      pipeline[o.status] += 1;
    }
  }

  const activityToday = backfillActivity(objects)[today] ?? 0;
  const tasksDoneToday = objects.filter((o) => o.type === 'task' && o.completed === today).length;

  return {
    date: today,
    totals,
    pipeline,
    pendingReview: pendingReviewCount(objects).total,
    maturityScore: maturityScore(objects).total,
    tasksDoneToday,
    activityCount: activityToday,
  };
}

/** 快照中的在途积压（captured + extracted + summarized） */
export function snapshotBacklog(snap: DailySnapshot): number {
  return snap.pipeline.captured + snap.pipeline.extracted + snap.pipeline.summarized;
}

export interface PipelineDiff {
  /**
   * 今日处理的 source 数（M4 输入环分子）：
   * 昨日在途减少量 + 今日 reviewed/linked 增加量，各自夹到 ≥ 0。
   */
  processed: number;
  /** 输入环目标值 = 昨日快照的积压数 */
  target: number;
}

/**
 * 相邻两日快照差分（通用约定 7：source 无 updated，只能靠差分）。
 * 调用方保证 yesterday.date 是 today.date 的前一天。
 */
export function diffPipeline(yesterday: DailySnapshot, today: DailySnapshot): PipelineDiff {
  const inflightDrop = snapshotBacklog(yesterday) - snapshotBacklog(today);
  const rlRise =
    today.pipeline.reviewed + today.pipeline.linked - (yesterday.pipeline.reviewed + yesterday.pipeline.linked);
  return {
    processed: Math.max(0, inflightDrop) + Math.max(0, rlRise),
    target: snapshotBacklog(yesterday),
  };
}

/**
 * 跨天补落：列出 (lastSnapshotDate, today) 开区间内缺失的日期。
 * today 当天尚未结束，不算缺失；lastSnapshotDate >= today 返回空。
 * 补落快照的 estimated 标记由调用方落盘时加上。
 */
export function missingDates(lastSnapshotDate: string, today: string): string[] {
  if (lastSnapshotDate >= today) return [];
  return dateRange(addDays(lastSnapshotDate, 1), addDays(today, -1));
}
