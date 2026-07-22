import { describe, expect, it } from 'vitest';
import { parseKosObject } from '../src/core/parse';

describe('parseKosObject 入口', () => {
  it('type 缺失返回 null', () => {
    expect(parseKosObject({ created: '2026-07-19' }, 'a.md')).toBeNull();
  });

  it('type 不识别返回 null', () => {
    expect(parseKosObject({ type: 'note' }, 'a.md')).toBeNull();
    expect(parseKosObject({ type: 42 }, 'a.md')).toBeNull();
  });

  it('公共字段：created 截前 10 位，tags 归一为数组', () => {
    const o = parseKosObject(
      { type: 'task', created: '2026-07-19T08:30:00', tags: 'single' },
      '32_任务/t.md',
    );
    expect(o?.created).toBe('2026-07-19');
    expect(o?.tags).toEqual(['single']);
  });

  it('created 缺失/非法为 null，不抛异常', () => {
    expect(parseKosObject({ type: 'task' }, 't.md')?.created).toBeNull();
    expect(parseKosObject({ type: 'task', created: 123 }, 't.md')?.created).toBeNull();
    expect(parseKosObject({ type: 'task', created: '19/07/2026' }, 't.md')?.created).toBeNull();
  });

  it('tags 类型不对时给 []，数组内非字符串被过滤', () => {
    expect(parseKosObject({ type: 'task', tags: 7 }, 't.md')?.tags).toEqual([]);
    expect(parseKosObject({ type: 'task', tags: ['a', 1, null, 'b'] }, 't.md')?.tags).toEqual(['a', 'b']);
  });
});

describe('各类型字段归一化', () => {
  it('source：status 缺失默认 captured，非法值也回落默认', () => {
    const def = parseKosObject({ type: 'source' }, '11_原材料/article/a.md');
    expect(def).toMatchObject({ type: 'source', status: 'captured' });
    const bad = parseKosObject({ type: 'source', status: 'weird' }, 'a.md');
    expect(bad).toMatchObject({ status: 'captured' });
  });

  it('source：format/importance 非法时按缺失处理', () => {
    const o = parseKosObject({ type: 'source', format: 'tweet', importance: 'urgent' }, 'a.md');
    expect(o).toMatchObject({ format: undefined, importance: undefined });
  });

  it('extract：review_status 默认 pending', () => {
    expect(parseKosObject({ type: 'extract' }, 'e.md')).toMatchObject({ review_status: 'pending' });
    expect(parseKosObject({ type: 'extract', review_status: 'reviewed' }, 'e.md')).toMatchObject({
      review_status: 'reviewed',
    });
  });

  it('summary：reviewed 默认 false，非布尔按 false', () => {
    expect(parseKosObject({ type: 'summary' }, 's.md')).toMatchObject({ reviewed: false });
    expect(parseKosObject({ type: 'summary', reviewed: 'yes' }, 's.md')).toMatchObject({ reviewed: false });
    expect(parseKosObject({ type: 'summary', reviewed: true }, 's.md')).toMatchObject({ reviewed: true });
  });

  it('task：日期归一化，scheduled_times 过滤、去重并排序', () => {
    const o = parseKosObject(
      {
        type: 'task', status: 'done', due: '2026-07-20', completed: '2026-07-19 18:00',
        scheduled_times: ['21:00', '09:00', '25:00', '09:00', 7],
      },
      't.md',
    );
    expect(o).toMatchObject({ due: '2026-07-20', scheduled_times: ['09:00', '21:00'], completed: '2026-07-19' });
    const empty = parseKosObject({ type: 'task', due: '', completed: '' }, 't.md');
    expect(empty).toMatchObject({ due: null, scheduled_times: [], completed: null });
    expect(parseKosObject({ type: 'task', scheduled_times: '07:30' }, 't.md')).toMatchObject({ scheduled_times: ['07:30'] });
  });

  it('diary：date 取自 frontmatter，energy 只收整数', () => {
    const o = parseKosObject({ type: 'diary', date: '2026-07-01', energy: 4, mood: '平静' }, 'd.md');
    expect(o).toMatchObject({ date: '2026-07-01', energy: 4, mood: '平静' });
    // 非整数（字符串/浮点）按缺失处理（M11 边界）
    expect(parseKosObject({ type: 'diary', energy: '3' }, 'd.md')).toMatchObject({ energy: null });
    expect(parseKosObject({ type: 'diary', energy: 3.5 }, 'd.md')).toMatchObject({ energy: null });
  });

  it('method：validated_times 默认 0，负数/非整数归 0', () => {
    expect(parseKosObject({ type: 'method' }, 'm.md')).toMatchObject({
      status: 'candidate',
      validated_times: 0,
    });
    expect(parseKosObject({ type: 'method', validated_times: -2 }, 'm.md')).toMatchObject({ validated_times: 0 });
    expect(parseKosObject({ type: 'method', validated_times: 5 }, 'm.md')).toMatchObject({ validated_times: 5 });
  });

  it('project：goal/priority/due/updated 字段保留', () => {
    const o = parseKosObject(
      { type: 'project', status: 'active', goal: 'g', priority: 'P1', updated: '2026-07-18' },
      'p.md',
    );
    expect(o).toMatchObject({ status: 'active', goal: 'g', priority: 'P1', updated: '2026-07-18', due: null });
  });

  it('goal：解析周期、占比、健康度和结果证据', () => {
    const goal = parseKosObject({
      type: 'goal', title: '研究表达', horizon: 'H1', period: '2027-H1', status: 'active',
      allocation_weight: 60, health: 'on_track', period_start: '2027-01-01', period_end: '2027-06-30',
      updated: '2027-01-10', human_confirmed: true, result_evidence: ['[[成果]]'],
    }, '30_目标/2027-H1/研究表达.md');
    expect(goal).toMatchObject({
      type: 'goal', horizon: 'H1', period: '2027-H1', status: 'active', allocation_weight: 60,
      health: 'on_track', human_confirmed: true, result_evidence: ['[[成果]]'],
    });
  });

  it('project：blocked 不回落为 active，并解析 Goal 关系与指标', () => {
    const project = parseKosObject({
      type: 'project', status: 'blocked', primary_goal: '[[Goal]]', supporting_goals: ['[[Support]]'],
      goal_alignment: 'direct', process_metrics: ['weekly | 每周研究 | 2'], result_metrics: [],
    }, '31_项目/研究.md');
    expect(project).toMatchObject({ status: 'blocked', primary_goal: '[[Goal]]', goal_alignment: 'direct', process_metrics: ['weekly | 每周研究 | 2'] });
  });

  it('dashboard：last_updated 保留完整 datetime 不截断', () => {
    const o = parseKosObject(
      { type: 'dashboard', date: '2026-07-19', last_updated: '2026-07-19T08:00:00' },
      'w.md',
    );
    expect(o).toMatchObject({ date: '2026-07-19', last_updated: '2026-07-19T08:00:00' });
  });

  it('12 种类型全部可解析', () => {
    for (const type of [
      'source',
      'extract',
      'summary',
      'research',
      'concept',
      'goal',
      'project',
      'task',
      'diary',
      'reflection',
      'personal_operating_profile',
      'method',
      'signal',
      'dashboard',
    ]) {
      expect(parseKosObject({ type }, 'x.md')?.type).toBe(type);
    }
  });
});
