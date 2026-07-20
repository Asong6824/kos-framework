/**
 * store.ts — 插件私有 data.json 的读写与迁移
 *
 * schema v1 见 docs/02_技术方案.md 3.2 节。只写插件私有 data.json，
 * 不触碰 vault 内任何文件（写入边界见 3.4 节）。
 */

import type { Plugin } from 'obsidian';
import type { KosObject } from '../core/model';
import { REPEATABLE_BADGES } from '../core/metrics';
import type { BadgeId } from '../core/metrics';
import { addDays, buildSnapshot, missingDates } from '../core/snapshot';
import type { DailySnapshot } from '../core/snapshot';
import { DEFAULT_SETTINGS } from '../settings';
import type { KosSettings } from '../settings';
import { DEFAULT_OBJECT_DIRS, normalizeObjectDirs } from '../core/model';

export const DATA_VERSION = 1;

/** data.json schema v1（02 文档 3.2 节） */
export interface PluginData {
  version: number;
  /** 安装日期 YYYY-MM-DD */
  installDate: string;
  /** 最后一次落盘快照的日期 */
  lastSnapshotDate: string;
  /** 日期 → 当日快照 */
  snapshots: Record<string, DailySnapshot>;
  /** 徽章 id → 解锁日期；可重复徽章记 null（次数见下方计数器） */
  badges: Record<string, string | null>;
  /** M13 inbox-zero 达成次数 */
  inboxZeroCount: number;
  /** M13 review-clear 达成次数（M14 周报/月报展示） */
  reviewClearCount: number;
}

/** 可重复徽章的计数器 key */
export type CounterKey = 'inboxZeroCount' | 'reviewClearCount';

/**
 * data.json 顶层结构 = PluginData + 设置。
 * Obsidian 每插件只有一个 data.json（loadData/saveData），设置与指标数据
 * 必须同文件持久化，否则互相覆盖；schema v1 字段保持原样，settings 为附加键。
 */
interface DataFile extends PluginData {
  settings: KosSettings;
}

/** 本地日历日 YYYY-MM-DD（注意区别于 core snapshot 的 UTC 工具：这里要"本地今天"） */
export function localToday(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

function defaultData(today: string): PluginData {
  return {
    version: DATA_VERSION,
    installDate: today,
    lastSnapshotDate: today,
    snapshots: {},
    badges: {},
    inboxZeroCount: 0,
    reviewClearCount: 0,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asNonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

export class KosDataStore {
  /** 设置与数据同文件持久化，load 后即为当前值；改后调 save() 落盘 */
  settings: KosSettings = { ...DEFAULT_SETTINGS, objectDirs: { ...DEFAULT_OBJECT_DIRS } };
  private data: PluginData = defaultData(localToday());

  constructor(private readonly plugin: Plugin) {}

  /** 当前数据（只读视图；修改请走方法，改后调 save()） */
  get pluginData(): Readonly<PluginData> {
    return this.data;
  }

  /** 快照按日期升序（喂 core metrics 的 snapshots 参数） */
  snapshotList(): DailySnapshot[] {
    return Object.values(this.data.snapshots).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /** 加载 data.json：版本检查 + 缺省字段补全（字段为插件自写，仅做存在性补全） */
  async load(): Promise<void> {
    const raw: unknown = await this.plugin.loadData();
    if (!isRecord(raw)) {
      this.data = defaultData(localToday());
      this.settings = { ...DEFAULT_SETTINGS, objectDirs: { ...DEFAULT_OBJECT_DIRS } };
      return;
    }
    if (raw.version !== DATA_VERSION) {
      // TODO: data.json 迁移入口 —— schema 升级时在此按旧版本号做字段迁移
    }
    const today = localToday();
    this.data = {
      version: DATA_VERSION,
      installDate: typeof raw.installDate === 'string' ? raw.installDate : today,
      lastSnapshotDate: typeof raw.lastSnapshotDate === 'string' ? raw.lastSnapshotDate : today,
      snapshots: isRecord(raw.snapshots) ? (raw.snapshots as Record<string, DailySnapshot>) : {},
      badges: isRecord(raw.badges) ? (raw.badges as Record<string, string | null>) : {},
      inboxZeroCount: asNonNegInt(raw.inboxZeroCount),
      reviewClearCount: asNonNegInt(raw.reviewClearCount),
    };
    const s = isRecord(raw.settings) ? raw.settings : {};
    // objectDirs 逐键归一：旧 data.json 没有该字段或个别键缺失/非法时回落标准默认
    this.settings = { ...DEFAULT_SETTINGS, ...s, objectDirs: normalizeObjectDirs(s.objectDirs) } as KosSettings;
  }

  async save(): Promise<void> {
    const file: DataFile = { ...this.data, settings: this.settings };
    await this.plugin.saveData(file);
  }

  /** 追加/覆盖某日快照，并推进 lastSnapshotDate */
  appendSnapshot(snap: DailySnapshot): void {
    this.data.snapshots[snap.date] = snap;
    if (snap.date > this.data.lastSnapshotDate) this.data.lastSnapshotDate = snap.date;
  }

  /**
   * 跨天处理（02 文档第 4 节）：
   * 1. (lastSnapshotDate, today) 开区间内的缺失日按对象当前状态补落，标 estimated
   *    （补落精度受限，仅用于曲线展示，不参与环比/差分，通用约定 6）；
   * 2. 昨天插件运行过（lastSnapshotDate 恰为昨天）但快照缺失时，按当前状态把昨天终态落盘。
   * 注：运行中的日期切换（interval 落昨日终态）与当日快照的事件流追加在 main.ts 接入。
   */
  ensureSnapshots(objects: KosObject[], today: string): void {
    for (const d of missingDates(this.data.lastSnapshotDate, today)) {
      this.appendSnapshot({ ...buildSnapshot(objects, d), estimated: true });
    }
    const yesterday = addDays(today, -1);
    if (this.data.lastSnapshotDate === yesterday && !(yesterday in this.data.snapshots)) {
      this.appendSnapshot(buildSnapshot(objects, yesterday));
    }
  }

  /** 记录徽章：不可重复徽章保留首次解锁日期；可重复徽章记 null，次数走 incrementCounter */
  recordBadge(id: BadgeId, date: string): void {
    if ((REPEATABLE_BADGES as readonly string[]).includes(id)) {
      this.data.badges[id] = null;
      return;
    }
    if (!(id in this.data.badges)) this.data.badges[id] = date;
  }

  /** 计数器 +1，返回新值 */
  incrementCounter(key: CounterKey): number {
    this.data[key] += 1;
    return this.data[key];
  }
}
