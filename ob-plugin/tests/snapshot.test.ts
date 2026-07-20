import { describe, expect, it } from 'vitest';
import { parseKosObject } from '../src/core/parse';
import {
  addDays,
  addMonths,
  backfillActivity,
  buildSnapshot,
  daysBetween,
  diffPipeline,
  missingDates,
  startOfMonth,
  startOfWeek,
} from '../src/core/snapshot';
import type { DailySnapshot } from '../src/core/snapshot';
import type { KosObject } from '../src/core/model';

function mk(type: string, extra: Record<string, unknown> = {}, path = `${type}.md`): KosObject {
  const o = parseKosObject({ type, ...extra }, path);
  if (!o) throw new Error(`parse failed: ${type}`);
  return o;
}

describe('日期工具', () => {
  it('addDays / daysBetween 跨月正确', () => {
    expect(addDays('2026-07-19', 1)).toBe('2026-07-20');
    expect(addDays('2026-07-01', -1)).toBe('2026-06-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-07-01', '2026-07-19')).toBe(18);
    expect(daysBetween('2026-07-19', '2026-07-01')).toBe(-18);
  });

  it('addMonths 月末夹取', () => {
    expect(addMonths('2026-07-19', -1)).toBe('2026-06-19');
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-31');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('startOfWeek 默认周一，可配周日', () => {
    // 2026-07-19 是周日
    expect(startOfWeek('2026-07-19', 1)).toBe('2026-07-13');
    expect(startOfWeek('2026-07-19', 0)).toBe('2026-07-19');
    expect(startOfWeek('2026-07-13', 1)).toBe('2026-07-13');
    expect(startOfMonth('2026-07-19')).toBe('2026-07-01');
  });
});

describe('backfillActivity', () => {
  it('dayScore = 创建数 + 完成数 + 日记存在(0/1)', () => {
    const objects = [
      mk('source', { created: '2026-07-19', status: 'ignored' }), // ignored 创建仍计入
      mk('concept', { created: '2026-07-19' }),
      mk('task', { created: '2026-07-18', completed: '2026-07-19' }), // 创建1 + 完成1
      mk('diary', { date: '2026-07-19' }), // 日记 +1
      mk('diary', { date: '2026-07-19' }, 'diary2.md'), // 同日第二篇日记不重复计
    ];
    const map = backfillActivity(objects);
    expect(map['2026-07-19']).toBe(1 + 1 + 1 + 1); // source创建 + concept创建 + task完成 + 日记存在
    expect(map['2026-07-18']).toBe(1);
  });

  it('补写日记按其 date 计入，与 created 无关（通用约定 5）', () => {
    const objects = [mk('diary', { date: '2026-06-01', created: '2026-07-19' })];
    const map = backfillActivity(objects);
    // created 计入 07-19，date 计入 06-01
    expect(map['2026-06-01']).toBe(1);
    expect(map['2026-07-19']).toBe(1);
  });

  it('includeDiary=false 时日记不计分', () => {
    const objects = [mk('diary', { date: '2026-07-19' })];
    expect(backfillActivity(objects, { includeDiary: false })['2026-07-19']).toBeUndefined();
  });

  it('created 缺失的对象不参与（通用约定 2）', () => {
    const map = backfillActivity([mk('concept', {})]);
    expect(Object.keys(map)).toHaveLength(0);
  });
});

describe('buildSnapshot', () => {
  it('字段齐全：totals 存活口径 / pipeline 全状态 / M8 / M9 / tasksDoneToday / activityCount', () => {
    const today = '2026-07-19';
    const objects = [
      mk('source', { created: '2026-07-10', status: 'captured' }),
      mk('source', { created: '2026-07-10', status: 'archived' }, 's2.md'),
      mk('source', { created: '2026-07-10', status: 'ignored' }, 's3.md'),
      mk('concept', { created: '2026-07-19', status: 'draft' }),
      mk('method', { created: '2026-07-01', status: 'deprecated' }, 'm.md'),
      mk('task', { created: '2026-07-01', completed: today, status: 'done' }, 't.md'),
      mk('diary', { date: today }, 'd.md'),
    ];
    const snap = buildSnapshot(objects, today);
    expect(snap.date).toBe(today);
    // 存活口径：captured source 1 + concept 1；archived/ignored/deprecated 排除
    expect(snap.totals.source).toBe(1);
    expect(snap.totals.concept).toBe(1);
    expect(snap.totals.method).toBeUndefined();
    expect(snap.totals.diary).toBe(1);
    // pipeline 全状态计数
    expect(snap.pipeline).toMatchObject({ captured: 1, archived: 1, ignored: 1, reviewed: 0 });
    // M8：concept draft=1，method deprecated=0
    expect(snap.maturityScore).toBe(1);
    // M9：concept draft 待审核
    expect(snap.pendingReview).toBe(1);
    expect(snap.tasksDoneToday).toBe(1);
    // 今日活动：concept 创建1 + task 完成1 + 日记1 = 3
    expect(snap.activityCount).toBe(3);
    expect(snap.estimated).toBeUndefined();
  });
});

describe('diffPipeline', () => {
  function snap(date: string, pipeline: Partial<DailySnapshot['pipeline']>): DailySnapshot {
    return {
      date,
      totals: {},
      pipeline: { captured: 0, extracted: 0, summarized: 0, reviewed: 0, linked: 0, archived: 0, ignored: 0, ...pipeline },
      pendingReview: 0,
      maturityScore: 0,
      tasksDoneToday: 0,
      activityCount: 0,
    };
  }

  it('在途减少 + reviewed/linked 增加 = 今日处理数', () => {
    // 昨日积压 5，今日积压 3（减少 2）；reviewed+linked 从 1 涨到 3（增加 2）
    const y = snap('2026-07-18', { captured: 3, extracted: 1, summarized: 1, reviewed: 1, linked: 0 });
    const t = snap('2026-07-19', { captured: 2, extracted: 1, summarized: 0, reviewed: 2, linked: 1 });
    const d = diffPipeline(y, t);
    expect(d.processed).toBe(2 + 2);
    expect(d.target).toBe(5);
  });

  it('新增捕获导致在途上涨时，减少量夹到 0', () => {
    const y = snap('2026-07-18', { captured: 1 });
    const t = snap('2026-07-19', { captured: 5 });
    expect(diffPipeline(y, t).processed).toBe(0);
    expect(diffPipeline(y, t).target).toBe(1);
  });

  it('昨日无积压时 target 为 0（显示无积压）', () => {
    const y = snap('2026-07-18', {});
    const t = snap('2026-07-19', { reviewed: 1 });
    const d = diffPipeline(y, t);
    expect(d.target).toBe(0);
    expect(d.processed).toBe(1);
  });
});

describe('missingDates 跨天补落', () => {
  it('列出 (lastSnapshotDate, today) 开区间', () => {
    expect(missingDates('2026-07-16', '2026-07-19')).toEqual(['2026-07-17', '2026-07-18']);
  });

  it('昨天已落盘则无缺失；lastSnapshotDate >= today 返回空', () => {
    expect(missingDates('2026-07-18', '2026-07-19')).toEqual([]);
    expect(missingDates('2026-07-19', '2026-07-19')).toEqual([]);
    expect(missingDates('2026-07-20', '2026-07-19')).toEqual([]);
  });
});
