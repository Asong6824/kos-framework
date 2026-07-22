import { describe, expect, it } from 'vitest';
import {
  activityHeatmap,
  activityStreak,
  compoundCurve,
  evaluateBadges,
  heatLevel,
  knowledgeAssetTotal,
  maturityScore,
  moodEnergyTrend,
  newAdditions,
  newBadges,
  pendingReviewCount,
  pendingReviewList,
  periodReport,
  pipelineFunnel,
  projectProgress,
  systemHealth,
  todayProgress,
  wikilinkTarget,
  MATURITY_MILESTONE_STEP,
} from '../src/core/metrics';
import { buildSnapshot } from '../src/core/snapshot';
import type { DailySnapshot } from '../src/core/snapshot';
import { parseKosObject } from '../src/core/parse';
import type { KosObject } from '../src/core/model';

const TODAY = '2026-07-19'; // 周日

let seq = 0;
/** 内联构造对象（走 parse，与真实数据路径一致） */
function mk(type: string, extra: Record<string, unknown> = {}): KosObject {
  const o = parseKosObject({ type, ...extra }, `${type}_${seq++}.md`);
  if (!o) throw new Error(`parse failed: ${type}`);
  return o;
}

function snap(date: string, pipeline: Partial<DailySnapshot['pipeline']>, extra: Partial<DailySnapshot> = {}): DailySnapshot {
  return {
    date,
    totals: {},
    pipeline: { captured: 0, extracted: 0, summarized: 0, reviewed: 0, linked: 0, archived: 0, ignored: 0, ...pipeline },
    pendingReview: 0,
    maturityScore: 0,
    tasksDoneToday: 0,
    activityCount: 0,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// M1
// ---------------------------------------------------------------------------
describe('M1 knowledgeAssetTotal', () => {
  it('concept 全状态计入；method 排除 deprecated；research 排除 archived', () => {
    const objects = [
      mk('concept', { status: 'draft' }),
      mk('concept', { status: 'mature' }),
      mk('method', { status: 'trusted' }),
      mk('method', { status: 'deprecated' }),
      mk('research', { status: 'complete' }),
      mk('research', { status: 'archived' }),
      mk('task'), // 非知识资产
    ];
    expect(knowledgeAssetTotal(objects)).toEqual({ total: 4, concept: 2, method: 1, research: 1 });
  });

  it('空库为 0', () => {
    expect(knowledgeAssetTotal([]).total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// M2
// ---------------------------------------------------------------------------
describe('M2 newAdditions', () => {
  it('本周默认周一起算；按类型分列；环比上一等长区间', () => {
    const objects = [
      mk('concept', { created: '2026-07-13' }), // 本周一
      mk('concept', { created: TODAY }),
      mk('task', { created: '2026-07-12' }), // 上周日，不进本周
      mk('source', { created: '2026-07-08' }), // 上期
    ];
    const r = newAdditions(objects, TODAY);
    expect(r.week.start).toBe('2026-07-13');
    expect(r.week.end).toBe(TODAY);
    expect(r.week.total).toBe(2);
    expect(r.week.byType.concept).toBe(2);
    // 上期 [07-06, 07-12]：task + source = 2
    expect(r.week.prevTotal).toBe(2);
    expect(r.week.delta).toBe(0);
    expect(r.week.pct).toBe(0);
    // 本月 [07-01, 07-19] 全部 4 个；上期 [06-12, 06-30] 为 0 → pct null
    expect(r.month.total).toBe(4);
    expect(r.month.prevTotal).toBe(0);
    expect(r.month.pct).toBeNull();
  });

  it('上期为 0 时 pct 为 null（只显示绝对值）', () => {
    const r = newAdditions([mk('concept', { created: TODAY })], TODAY);
    expect(r.week.prevTotal).toBe(0);
    expect(r.week.pct).toBeNull();
  });

  it('周起始日可配（周日）', () => {
    const objects = [mk('concept', { created: '2026-07-12' })]; // 上周日
    const r = newAdditions(objects, TODAY, { weekStart: 0 });
    expect(r.week.start).toBe('2026-07-19');
    expect(r.week.total).toBe(0); // 周日口径下 07-12 属于上一周
  });

  it('created 缺失的对象不参与', () => {
    expect(newAdditions([mk('concept', {})], TODAY).week.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// M3
// ---------------------------------------------------------------------------
describe('M3 compoundCurve', () => {
  it('自最早 created 至今累计；source 为对照线；含已归档（累计口径）', () => {
    const objects = [
      mk('concept', { created: '2026-07-17' }),
      mk('method', { created: '2026-07-18' }),
      mk('research', { created: '2026-07-18', status: 'archived' }),
      mk('source', { created: '2026-07-18', status: 'ignored' }),
    ];
    const curve = compoundCurve(objects, TODAY);
    expect(curve.map((p) => p.date)).toEqual(['2026-07-17', '2026-07-18', '2026-07-19']);
    expect(curve[2]).toEqual({ date: TODAY, knowledge: 3, source: 1 });
  });

  it('无任何 created 返回空', () => {
    expect(compoundCurve([mk('task', {})], TODAY)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M4
// ---------------------------------------------------------------------------
describe('M4 todayProgress', () => {
  it('任务环：分子=今日完成；分母含 due≤今日 且 todo/doing；比率=done/total', () => {
    const objects = [
      mk('task', { status: 'done', completed: TODAY }),
      mk('task', { status: 'todo', due: '2026-07-18' }),
      mk('task', { status: 'doing', due: TODAY }),
      mk('task', { status: 'todo', due: '2026-07-20' }), // 明天到期，不进分母
      mk('task', { status: 'todo' }), // 无 due，不进分母
    ];
    const r = todayProgress(objects, [], TODAY);
    expect(r.task.done).toBe(1);
    expect(r.task.total).toBe(3);
    expect(r.task.ratio).toBeCloseTo(1 / 3);
  });

  it('任务环分母为 0 时 ratio 为 null，只显示完成数', () => {
    const r = todayProgress([], [], TODAY);
    expect(r.task).toEqual({ done: 0, total: 0, ratio: null });
  });

  it('输入环：昨日快照差分；目标=昨日积压', () => {
    const objects = [
      mk('source', { status: 'captured' }),
      mk('source', { status: 'reviewed' }),
      mk('source', { status: 'linked' }),
    ];
    const y = snap('2026-07-18', { captured: 3, summarized: 1, reviewed: 1 });
    const r = todayProgress(objects, [y], TODAY);
    // 在途 4→1 减 3；reviewed+linked 1→2 增 1
    expect(r.input.processed).toBe(4);
    expect(r.input.target).toBe(4);
    expect(r.input.ratio).toBe(1);
  });

  it('昨日快照缺失或为 estimated 时 processed 为 null（差分不可信）', () => {
    const objects = [mk('source', { status: 'captured' })];
    expect(todayProgress(objects, [], TODAY).input.processed).toBeNull();
    const est = snap('2026-07-18', { captured: 2 }, { estimated: true });
    expect(todayProgress(objects, [est], TODAY).input.processed).toBeNull();
  });

  it('昨日无积压时 ratio 为 null（显示无积压）', () => {
    const y = snap('2026-07-18', {});
    const r = todayProgress([mk('source', { status: 'reviewed' })], [y], TODAY);
    expect(r.input.target).toBe(0);
    expect(r.input.ratio).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M5
// ---------------------------------------------------------------------------
describe('M5 activityHeatmap / heatLevel', () => {
  it('ignored source 的创建仍计入；heatmapIncludeDiary=false 关闭日记分', () => {
    const objects = [mk('source', { created: TODAY, status: 'ignored' }), mk('diary', { date: TODAY })];
    expect(activityHeatmap(objects)[TODAY]).toBe(2);
    expect(activityHeatmap(objects, { heatmapIncludeDiary: false })[TODAY]).toBe(1);
  });

  it('五档色阶边界：0 / 1–2 / 3–5 / 6–9 / ≥10', () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(1)).toBe(1);
    expect(heatLevel(2)).toBe(1);
    expect(heatLevel(3)).toBe(2);
    expect(heatLevel(5)).toBe(2);
    expect(heatLevel(6)).toBe(3);
    expect(heatLevel(9)).toBe(3);
    expect(heatLevel(10)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// M6
// ---------------------------------------------------------------------------
describe('M6 activityStreak', () => {
  it('连续活跃天数与历史最长', () => {
    const objects = [
      mk('concept', { created: '2026-07-17' }),
      mk('concept', { created: '2026-07-18' }),
      mk('concept', { created: TODAY }),
      mk('concept', { created: '2026-07-01' }), // 孤立的一天
    ];
    const r = activityStreak(objects, TODAY);
    expect(r.current).toBe(3);
    expect(r.longest).toBe(3);
  });

  it('端点规则：今天无活动时 streak 不死，以昨天为端点', () => {
    const objects = [mk('concept', { created: '2026-07-17' }), mk('concept', { created: '2026-07-18' })];
    const r = activityStreak(objects, TODAY);
    expect(r.current).toBe(2);
    expect(r.longest).toBe(2);
  });

  it('昨天也无活动时 streak 归零', () => {
    const objects = [mk('concept', { created: '2026-07-15' })];
    expect(activityStreak(objects, TODAY).current).toBe(0);
  });

  it('补记历史日期的日记不续今天（通用约定 5 + M6 边界）', () => {
    // 今天补写一篇日期为 07-18 的日记：created 在今天有活动，date 在昨天也有活动
    const objects = [mk('diary', { date: '2026-07-18', created: TODAY })];
    expect(activityStreak(objects, TODAY).current).toBe(2);
    // 若补记日记的 created 也不是今天（如 harness 补落），单靠 date 不续今天
    const objects2 = [mk('diary', { date: '2026-07-10', created: '2026-07-10' })];
    expect(activityStreak(objects2, TODAY).current).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// M7
// ---------------------------------------------------------------------------
describe('M7 pipelineFunnel', () => {
  it('各级计数 / 积压 / 整体转化率 / 相邻转化率', () => {
    const objects = [
      mk('source', { status: 'captured' }),
      mk('source', { status: 'captured' }),
      mk('source', { status: 'extracted' }),
      mk('source', { status: 'summarized' }),
      mk('source', { status: 'reviewed' }),
      mk('source', { status: 'linked' }),
      mk('source', { status: 'archived' }),
      mk('source', { status: 'ignored' }),
    ];
    const f = pipelineFunnel(objects);
    expect(f.stages).toEqual({ captured: 2, extracted: 1, summarized: 1, reviewed: 1, linked: 1, archived: 1, ignored: 1 });
    expect(f.backlog).toBe(4);
    // (1+1+1)/(8-1) = 3/7
    expect(f.conversion).toBeCloseTo(3 / 7);
    expect(f.stageRates).toEqual([
      { from: 'captured', to: 'extracted', rate: 0.5 },
      { from: 'extracted', to: 'summarized', rate: 1 },
      { from: 'summarized', to: 'reviewed', rate: 1 },
      { from: 'reviewed', to: 'linked', rate: 1 },
    ]);
  });

  it('分母为 0：无 source 时 conversion 为 null；级率为 null', () => {
    const f = pipelineFunnel([mk('source', { status: 'ignored' })]);
    expect(f.conversion).toBeNull();
    expect(f.stageRates.every((r) => r.rate === null)).toBe(true);
    expect(pipelineFunnel([]).conversion).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M8
// ---------------------------------------------------------------------------
describe('M8 maturityScore', () => {
  it('权重：concept 1/2/3，method 1/2/3/0，research 1/2/3/0', () => {
    const objects = [
      mk('concept', { status: 'draft' }), // 1
      mk('concept', { status: 'mature' }), // 3
      mk('method', { status: 'usable' }), // 2
      mk('method', { status: 'deprecated' }), // 0
      mk('research', { status: 'complete' }), // 3
      mk('research', { status: 'archived' }), // 0
    ];
    const r = maturityScore(objects);
    expect(r).toMatchObject({ total: 9, concept: 4, method: 2, research: 3 });
  });

  it('里程碑：距下一整数里程碑', () => {
    const r = maturityScore([mk('concept', { status: 'draft' })]);
    expect(r.nextMilestone).toBe(MATURITY_MILESTONE_STEP);
    expect(r.toNext).toBe(MATURITY_MILESTONE_STEP - 1);
    expect(maturityScore([])).toMatchObject({ total: 0, nextMilestone: MATURITY_MILESTONE_STEP });
  });
});

// ---------------------------------------------------------------------------
// M9
// ---------------------------------------------------------------------------
describe('M9 pendingReviewCount', () => {
  it('七类待审核全部计入，已审核/非草稿不计', () => {
    const objects = [
      mk('summary', { reviewed: false }),
      mk('summary', { reviewed: true }),
      mk('extract', { review_status: 'pending' }),
      mk('extract', { review_status: 'reviewed' }),
      mk('research', { status: 'draft' }),
      mk('research', { status: 'reviewed' }),
      mk('concept', { status: 'draft' }),
      mk('concept', { status: 'verified' }),
      mk('reflection', { status: 'raw' }),
      mk('method', { status: 'candidate' }),
      mk('method', { status: 'usable' }),
      mk('personal_operating_profile', { status: 'draft' }),
      mk('personal_operating_profile', { status: 'active' }),
    ];
    const r = pendingReviewCount(objects);
    expect(r.total).toBe(7);
    expect(r.byType.summary).toBe(1);
    expect(r.byType.personal_operating_profile).toBe(1);
  });

  it('清零时 total 为 0', () => {
    expect(pendingReviewCount([mk('concept', { status: 'mature' })]).total).toBe(0);
  });

  it('pendingReviewList 返回待审核对象本身，与 count 同一口径', () => {
    const objects = [
      mk('summary', { reviewed: false }),
      mk('summary', { reviewed: true }),
      mk('extract', { review_status: 'pending' }),
      mk('research', { status: 'draft' }),
      mk('concept', { status: 'verified' }),
      mk('reflection', { status: 'raw' }),
      mk('method', { status: 'candidate' }),
      mk('personal_operating_profile', { status: 'draft' }),
      mk('task'), // 不在 M9 范围
    ];
    const list = pendingReviewList(objects);
    expect(list.length).toBe(pendingReviewCount(objects).total);
    expect(list.map((o) => o.type).sort()).toEqual([
      'extract',
      'method',
      'personal_operating_profile',
      'reflection',
      'research',
      'summary',
    ]);
  });
});

// ---------------------------------------------------------------------------
// M10
// ---------------------------------------------------------------------------
describe('M10 projectProgress', () => {
  it('推进度 = done/全部任务；wikilink 各种写法都能匹配', () => {
    const objects = [
      mk('project', { title: '写书', status: 'active', updated: TODAY }),
      mk('task', { project: '[[31_项目/写书]]', status: 'done' }),
      mk('task', { project: '[[写书]]', status: 'todo' }),
      mk('task', { project: '[[31_项目/写书|写书项目]]', status: 'doing' }),
      mk('task', { project: '[[别的项目]]', status: 'done' }),
    ];
    const [p] = projectProgress(objects, TODAY);
    expect(p.total).toBe(3);
    expect(p.done).toBe(1);
    expect(p.progress).toBeCloseTo(1 / 3);
  });

  it('无任务时 progress 为 null（显示 —）', () => {
    const [p] = projectProgress([mk('project', { title: '空项目' })], TODAY);
    expect(p.progress).toBeNull();
  });

  it('停滞：active 且 今天−updated ≥ 阈值（默认 3 天，可配）', () => {
    const objects = [
      mk('project', { title: 'A', status: 'active', updated: '2026-07-16' }), // 恰好 3 天 → 停滞
      mk('project', { title: 'B', status: 'active', updated: '2026-07-17' }), // 2 天 → 不停滞
      mk('project', { title: 'C', status: 'paused', updated: '2026-06-01' }), // 非 active → 不停滞
    ];
    const [a, b, c] = projectProgress(objects, TODAY);
    expect(a.stale).toBe(true);
    expect(a.daysSinceUpdate).toBe(3);
    expect(b.stale).toBe(false);
    expect(c.stale).toBe(false);
    // 阈值可配
    const [a2] = projectProgress(objects, TODAY, { staleThresholdDays: 10 });
    expect(a2.stale).toBe(false);
  });

  it('updated 缺失时不判定（stale 为 null），daysSinceUpdate 为 null', () => {
    const [p] = projectProgress([mk('project', { title: '无updated', status: 'active' })], TODAY);
    expect(p.stale).toBeNull();
    expect(p.daysSinceUpdate).toBeNull();
  });

  it('wikilinkTarget 归一化', () => {
    expect(wikilinkTarget('[[31_项目/写书]]')).toBe('写书');
    expect(wikilinkTarget('[[写书|别名]]')).toBe('写书');
    expect(wikilinkTarget('写书.md')).toBe('写书');
  });
});

// ---------------------------------------------------------------------------
// M11
// ---------------------------------------------------------------------------
describe('M11 moodEnergyTrend', () => {
  it('energy 按周取均值；mood 词频；跳过 energy 缺失的日记并计数', () => {
    const objects = [
      mk('diary', { date: '2026-07-13', energy: 2, mood: '累' }), // 本周一
      mk('diary', { date: '2026-07-14', energy: 4, mood: '累' }),
      mk('diary', { date: '2026-07-15' }), // energy 缺失 → 跳过
      mk('diary', { date: '2026-07-06', energy: 5, mood: '好' }), // 上周
    ];
    const r = moodEnergyTrend(objects);
    expect(r.weeks).toHaveLength(2);
    const thisWeek = r.weeks.find((w) => w.weekStart === '2026-07-13');
    expect(thisWeek?.avgEnergy).toBe(3);
    expect(thisWeek?.energyCount).toBe(2);
    expect(r.moods).toEqual({ 累: 2, 好: 1 });
    expect(r.skippedEnergy).toBe(1);
  });

  it('整周 energy 全缺时 avgEnergy 为 null；avgDayScore 叠加 M5', () => {
    const objects = [mk('diary', { date: '2026-07-13' }), mk('concept', { created: '2026-07-14' })];
    const [w] = moodEnergyTrend(objects).weeks;
    expect(w.avgEnergy).toBeNull();
    // 该周活动：07-13 日记1 + 07-14 概念1 = 2，周日均 2/7
    expect(w.avgDayScore).toBeCloseTo(2 / 7);
  });
});

// ---------------------------------------------------------------------------
// M12
// ---------------------------------------------------------------------------
describe('M12 systemHealth', () => {
  it('100 起扣：error −5、warning −2，下限 0', () => {
    expect(systemHealth({ errors: 0, warnings: 0 }).score).toBe(100);
    expect(systemHealth({ errors: 2, warnings: 3 }).score).toBe(100 - 10 - 6);
    expect(systemHealth({ errors: 30, warnings: 10 }).score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// M13
// ---------------------------------------------------------------------------
describe('M13 徽章', () => {
  const base = { currentStreak: 0, inboxFileCount: 1, pendingReview: 1 };

  it('concept 系列与 first-mature（存活口径）', () => {
    const objects = Array.from({ length: 50 }, () => mk('concept', { status: 'draft' }));
    objects.push(mk('concept', { status: 'mature' }));
    const earned = evaluateBadges({ objects, ...base });
    expect(earned).toContain('first-concept');
    expect(earned).toContain('concept-50');
    expect(earned).not.toContain('concept-100');
    expect(earned).toContain('first-mature');
  });

  it('summary-100 为累计口径（已 reviewed 也计入创建总量）', () => {
    const objects = Array.from({ length: 100 }, () => mk('summary', { reviewed: true }));
    expect(evaluateBadges({ objects, ...base })).toContain('summary-100');
  });

  it('streak 系列', () => {
    expect(evaluateBadges({ objects: [], ...base, currentStreak: 30 })).toEqual(
      expect.arrayContaining(['streak-7', 'streak-30']),
    );
    expect(evaluateBadges({ objects: [], ...base, currentStreak: 6 })).not.toContain('streak-7');
  });

  it('diary-30 / task-100（completed 字段计数）', () => {
    const diaries = Array.from({ length: 30 }, () => mk('diary', { date: '2026-07-01' }));
    expect(evaluateBadges({ objects: diaries, ...base })).toContain('diary-30');
    const tasks = Array.from({ length: 100 }, () => mk('task', { status: 'done', completed: '2026-07-01' }));
    expect(evaluateBadges({ objects: tasks, ...base })).toContain('task-100');
    // status=done 但 completed 字段缺失 → 不计（通用约定 2）
    expect(evaluateBadges({ objects: [mk('task', { status: 'done' })], ...base })).not.toContain('task-100');
  });

  it('method-trusted / method-validated-10 / project-complete', () => {
    const objects = [
      mk('method', { status: 'trusted', validated_times: 4 }),
      mk('method', { status: 'usable', validated_times: 6 }),
      mk('project', { status: 'completed' }),
    ];
    const earned = evaluateBadges({ objects, ...base });
    expect(earned).toEqual(expect.arrayContaining(['method-trusted', 'method-validated-10', 'project-complete']));
  });

  it('inbox-zero：首次观察到 0 或从非零回到 0；review-clear 同理', () => {
    expect(evaluateBadges({ objects: [], inboxFileCount: 0, currentStreak: 0, pendingReview: 1 })).toContain(
      'inbox-zero',
    );
    expect(
      evaluateBadges({ objects: [], inboxFileCount: 0, prevInboxFileCount: 0, currentStreak: 0, pendingReview: 1 }),
    ).not.toContain('inbox-zero');
    expect(
      evaluateBadges({ objects: [], inboxFileCount: 0, prevInboxFileCount: 3, currentStreak: 0, pendingReview: 1 }),
    ).toContain('inbox-zero');
    expect(
      evaluateBadges({ objects: [], inboxFileCount: 1, currentStreak: 0, pendingReview: 0, prevPendingReview: 5 }),
    ).toContain('review-clear');
    // 一直为 0 不重复触发
    expect(
      evaluateBadges({ objects: [], inboxFileCount: 1, currentStreak: 0, pendingReview: 0, prevPendingReview: 0 }),
    ).not.toContain('review-clear');
  });

  it('newBadges 与已解锁集合求差；可重复徽章每次达成都算新解锁', () => {
    const earned = evaluateBadges({
      objects: [mk('concept')],
      currentStreak: 0,
      inboxFileCount: 0,
      prevInboxFileCount: 2,
      pendingReview: 1,
    });
    expect(earned.sort()).toEqual(['first-concept', 'inbox-zero']);
    const unlocked = { 'first-concept': '2026-07-01', 'inbox-zero': '2026-07-02' };
    // first-concept 已解锁被过滤；inbox-zero 可重复，仍算新解锁
    expect(newBadges(earned, unlocked)).toEqual(['inbox-zero']);
  });
});

// ---------------------------------------------------------------------------
// M14
// ---------------------------------------------------------------------------
describe('M14 periodReport', () => {
  it('周报环比字段：新增 / 任务完成 / 转化率 / 积压 / 成熟度增量 / streak', () => {
    const objects = [
      mk('concept', { created: '2026-07-14', status: 'verified' }), // 本周新增，M8=2
      mk('concept', { created: '2026-07-08', status: 'draft' }), // 上周新增
      mk('task', { status: 'done', completed: '2026-07-15' }),
      mk('task', { status: 'done', completed: '2026-07-09' }),
      mk('source', { status: 'captured' }),
      mk('source', { status: 'reviewed' }),
    ];
    // 对比快照 = 7 天前（2026-07-12）
    const prev = snap('2026-07-12', { captured: 4, reviewed: 1 }, { maturityScore: 1 });
    const r = periodReport(objects, [prev], TODAY, 'week');
    expect(r.start).toBe('2026-07-13');
    expect(r.newTotal).toBe(1);
    expect(r.prevNewTotal).toBe(1);
    expect(r.newPct).toBe(0);
    expect(r.tasksCompleted).toBe(1);
    expect(r.prevTasksCompleted).toBe(1);
    // 当前转化率 1/2；快照转化率 1/5
    expect(r.conversion).toBeCloseTo(0.5);
    expect(r.prevConversion).toBeCloseTo(1 / 5);
    expect(r.backlog).toBe(1);
    expect(r.prevBacklog).toBe(4);
    expect(r.maturity).toBe(3);
    expect(r.prevMaturity).toBe(1);
    expect(r.maturityDelta).toBe(2);
    expect(r.prevSnapshotMissing).toBe(false);
    expect(r.prevSnapshotEstimated).toBe(false);
  });

  it('对比快照缺失或为 estimated 时 prev* 为 null 并标注（通用约定 6）', () => {
    const objects = [mk('concept', { created: TODAY })];
    const missing = periodReport(objects, [], TODAY, 'week');
    expect(missing.prevSnapshotMissing).toBe(true);
    expect(missing.prevMaturity).toBeNull();
    expect(missing.maturityDelta).toBeNull();

    const est = snap('2026-07-12', { captured: 1 }, { estimated: true, maturityScore: 5 });
    const estimated = periodReport(objects, [est], TODAY, 'week');
    expect(estimated.prevSnapshotEstimated).toBe(true);
    expect(estimated.prevMaturity).toBeNull();
    expect(estimated.maturityDelta).toBeNull();
  });

  it('月报对比点为一个月前；清零次数与新徽章由调用方透传', () => {
    const objects = [mk('task', { status: 'done', completed: TODAY })];
    const prev = snap('2026-06-19', {}, { maturityScore: 0 });
    const r = periodReport(objects, [prev], TODAY, 'month', undefined, {
      reviewClearCount: 2,
      newBadges: ['first-concept'],
    });
    expect(r.start).toBe('2026-07-01');
    expect(r.prevSnapshotMissing).toBe(false);
    expect(r.reviewClearCount).toBe(2);
    expect(r.newBadges).toEqual(['first-concept']);
  });
});

// ---------------------------------------------------------------------------
// 与 snapshot 的协作（buildSnapshot 内嵌 M8/M9）
// ---------------------------------------------------------------------------
describe('buildSnapshot 与指标联动', () => {
  it('快照中的 maturityScore / pendingReview 与 M8/M9 一致', () => {
    const objects = [mk('concept', { status: 'verified' }), mk('summary', { reviewed: false })];
    const s = buildSnapshot(objects, TODAY);
    expect(s.maturityScore).toBe(maturityScore(objects).total);
    expect(s.pendingReview).toBe(pendingReviewCount(objects).total);
  });
});
