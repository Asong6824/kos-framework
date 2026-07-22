import { describe, expect, it } from 'vitest';
import {
  classifyByPath,
  DEFAULT_OBJECT_DIRS,
  DEFAULT_STATE,
  INBOX_PREFIX,
  isTerminalStatus,
  KOS_OBJECT_TYPES,
  LEGACY_OBJECT_DIRS,
  migrateLegacyObjectDirs,
  normalizeObjectDirs,
  OBJECT_DIR_KEYS,
  PATH_PREFIX_RULES,
  STATE_MACHINES,
  TERMINAL_STATUSES,
} from '../src/core/model';

describe('model 常量表', () => {
  it('恰好 14 种对象类型（含 Goal 与 dashboard）', () => {
    expect(KOS_OBJECT_TYPES).toHaveLength(14);
    expect(KOS_OBJECT_TYPES).toContain('personal_operating_profile');
    expect(KOS_OBJECT_TYPES).toContain('goal');
  });

  it('每种有状态对象都有状态机或显式为 null', () => {
    for (const t of KOS_OBJECT_TYPES) {
      expect(STATE_MACHINES[t]).toBeDefined();
    }
    expect(STATE_MACHINES.diary).toBeNull();
    expect(STATE_MACHINES.signal).toBeNull();
    expect(STATE_MACHINES.dashboard).toBeNull();
  });

  it('终态集合为 archived/cancelled/deprecated/ignored', () => {
    expect(TERMINAL_STATUSES).toEqual(['archived', 'cancelled', 'deprecated', 'ignored']);
    expect(isTerminalStatus('archived')).toBe(true);
    expect(isTerminalStatus('draft')).toBe(false);
  });

  it('冻结态不出现在任何流转边的 from 中', () => {
    for (const t of KOS_OBJECT_TYPES) {
      const m = STATE_MACHINES[t];
      if (!m) continue;
      for (const edge of m.transitions) {
        expect(m.frozenStates).not.toContain(edge.from);
      }
    }
  });

  it('默认状态覆盖全部有状态对象', () => {
    expect(DEFAULT_STATE.source).toBe('captured');
    expect(DEFAULT_STATE.extract).toBe('pending');
    expect(DEFAULT_STATE.summary).toBe('false');
    expect(DEFAULT_STATE.task).toBe('todo');
    expect(DEFAULT_STATE.diary).toBeUndefined();
  });

  it('project 的 Goal 关系和 priority 为字段级需确认', () => {
    expect(STATE_MACHINES.project?.protectedFields).toEqual(['goal', 'primary_goal', 'supporting_goals', 'goal_alignment', 'priority']);
  });

  it('project blocked 保持为合法状态，Goal 激活需要确认', () => {
    expect(STATE_MACHINES.project?.transitions.some((edge) => edge.from === 'active' && edge.to === 'blocked')).toBe(true);
    expect(STATE_MACHINES.goal?.transitions.find((edge) => edge.from === 'draft' && edge.to === 'active')?.requiresConfirmation).toBe(true);
  });

  it('method 晋升边标注实践次数要求', () => {
    const m = STATE_MACHINES.method;
    const usable = m?.transitions.find((t) => t.from === 'candidate' && t.to === 'usable');
    const trusted = m?.transitions.find((t) => t.from === 'usable' && t.to === 'trusted');
    expect(usable?.requiresConfirmation).toBe(true);
    expect(usable?.note).toContain('1+');
    expect(trusted?.note).toContain('3+');
  });
});

describe('路径前缀归类', () => {
  it('各前缀命中对应类型', () => {
    expect(classifyByPath('11_原材料/book/某书.md')).toBe('source');
    expect(classifyByPath('20_处理区/摘录/某书_摘录.md')).toBe('extract');
    expect(classifyByPath('20_处理区/摘要/某书_摘要.md')).toBe('summary');
    expect(classifyByPath('21_研究/AI/主题/笔记.md')).toBe('research');
    expect(classifyByPath('22_知识库/AI/概念.md')).toBe('concept');
    expect(classifyByPath('31_项目/某项目.md')).toBe('project');
    expect(classifyByPath('32_任务/完成任务.md')).toBe('task');
    expect(classifyByPath('40_日记/2026/07/2026-07-19.md')).toBe('diary');
    expect(classifyByPath('41_认知记录/某反思.md')).toBe('reflection');
    expect(classifyByPath('42_个人操作画像/画像.md')).toBe('personal_operating_profile');
    expect(classifyByPath('30_目标/2027-H1/研究表达.md')).toBe('goal');
    expect(classifyByPath('23_方法库/方法.md')).toBe('method');
    expect(classifyByPath('12_信息雷达/daily_briefs/2026-07-19_简报.md')).toBe('signal');
    expect(classifyByPath('00_工作台/今日工作台.md')).toBe('dashboard');
  });

  it('摘录/摘要比处理区其他路径更具体，优先命中', () => {
    const extractRule = PATH_PREFIX_RULES.findIndex((r) => r.prefix === '20_处理区/摘录/');
    const summaryRule = PATH_PREFIX_RULES.findIndex((r) => r.prefix === '20_处理区/摘要/');
    expect(extractRule).toBeGreaterThanOrEqual(0);
    expect(summaryRule).toBeGreaterThanOrEqual(0);
  });

  it('未登记路径返回 null', () => {
    expect(classifyByPath('99_其他/随便.md')).toBeNull();
    expect(classifyByPath(`${INBOX_PREFIX}未整理.md`)).toBeNull();
  });
});

describe('对象目录映射（ObjectDirs）', () => {
  it('默认值为 framework 标准布局，且 13 键齐全', () => {
    expect(OBJECT_DIR_KEYS).toHaveLength(13);
    for (const key of OBJECT_DIR_KEYS) {
      expect(typeof DEFAULT_OBJECT_DIRS[key]).toBe('string');
      expect(DEFAULT_OBJECT_DIRS[key].length).toBeGreaterThan(0);
    }
    expect(DEFAULT_OBJECT_DIRS.inbox).toBe('10_收件箱');
    expect(DEFAULT_OBJECT_DIRS.source).toBe('11_原材料');
    expect(DEFAULT_OBJECT_DIRS.concept).toBe('22_知识库');
    expect(DEFAULT_OBJECT_DIRS.goal).toBe('30_目标');
    expect(DEFAULT_OBJECT_DIRS.diary).toBe('40_日记');
    expect(DEFAULT_OBJECT_DIRS.radar).toBe('12_信息雷达');
  });

  it('默认值与 PATH_PREFIX_RULES / INBOX_PREFIX 标准布局一致', () => {
    expect(`${DEFAULT_OBJECT_DIRS.inbox}/`).toBe(INBOX_PREFIX);
    // personal_operating_profile / dashboard 无 objectDirs 键，不在对照表内
    const typeToKey = {
      source: 'source',
      extract: 'extract',
      summary: 'summary',
      research: 'research',
      concept: 'concept',
      goal: 'goal',
      project: 'project',
      task: 'task',
      diary: 'diary',
      reflection: 'reflection',
      method: 'method',
      signal: 'radar',
    } as const;
    for (const rule of PATH_PREFIX_RULES) {
      const key = typeToKey[rule.type as keyof typeof typeToKey];
      if (!key) continue;
      expect(`${DEFAULT_OBJECT_DIRS[key]}/`).toBe(rule.prefix);
    }
  });

  it('normalizeObjectDirs：非对象输入返回纯默认副本', () => {
    for (const bad of [undefined, null, 42, 'x', [], true]) {
      const out = normalizeObjectDirs(bad);
      expect(out).toEqual(DEFAULT_OBJECT_DIRS);
      expect(out).not.toBe(DEFAULT_OBJECT_DIRS); // 必须返回副本，外部改动不污染默认
    }
  });

  it('normalizeObjectDirs：部分键覆盖，其余回落默认（旧 data.json 兼容）', () => {
    const out = normalizeObjectDirs({ inbox: '10_输入/11_收件箱', concept: '30_知识/31_知识库' });
    expect(out.inbox).toBe('10_输入/11_收件箱');
    expect(out.concept).toBe('30_知识/31_知识库');
    expect(out.source).toBe(DEFAULT_OBJECT_DIRS.source);
    expect(out.task).toBe(DEFAULT_OBJECT_DIRS.task);
  });

  it('normalizeObjectDirs：trim 并去首尾斜杠，空串回落默认', () => {
    const out = normalizeObjectDirs({
      inbox: '  10_输入/11_收件箱/ ',
      source: '/11_原材料/',
      diary: '   ',
      task: 123,
      concept: '',
    });
    expect(out.inbox).toBe('10_输入/11_收件箱');
    expect(out.source).toBe('11_原材料');
    expect(out.diary).toBe(DEFAULT_OBJECT_DIRS.diary);
    expect(out.task).toBe(DEFAULT_OBJECT_DIRS.task);
    expect(out.concept).toBe(DEFAULT_OBJECT_DIRS.concept);
  });

  it('normalizeObjectDirs：忽略未知键', () => {
    const out = normalizeObjectDirs({ unknown_dir: '99_其他' });
    expect(out).toEqual(DEFAULT_OBJECT_DIRS);
    expect('unknown_dir' in out).toBe(false);
  });

  it('Layout v1 默认目录迁移到 v2，同时保留用户自定义目录', () => {
    const migrated = normalizeObjectDirs(migrateLegacyObjectDirs({
      ...LEGACY_OBJECT_DIRS,
      project: '我的项目',
    }));
    expect(migrated.method).toBe('23_方法库');
    expect(migrated.goal).toBe('30_目标');
    expect(migrated.task).toBe('32_任务');
    expect(migrated.diary).toBe('40_日记');
    expect(migrated.reflection).toBe('41_认知记录');
    expect(migrated.radar).toBe('12_信息雷达');
    expect(migrated.project).toBe('我的项目');
  });
});
