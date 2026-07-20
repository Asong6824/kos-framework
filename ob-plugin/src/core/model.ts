/**
 * model.ts — kos 对象规范的 TypeScript 编码
 *
 * 契约来源：vault/90_系统/规则/对象规范.md
 * 状态机/权限表来源：docs/02_技术方案.md 3.1 节（唯一依据）
 *
 * 约定：interface 字段名与 frontmatter 字段名保持一致（snake_case），
 * 避免 parse 层做名称映射时引入偏差。
 */

/** 12 种 kos 对象类型 */
export type KosObjectType =
  | 'source'
  | 'extract'
  | 'summary'
  | 'research'
  | 'concept'
  | 'project'
  | 'task'
  | 'diary'
  | 'reflection'
  | 'personal_operating_profile'
  | 'method'
  | 'signal'
  | 'dashboard';

export const KOS_OBJECT_TYPES: readonly KosObjectType[] = [
  'source',
  'extract',
  'summary',
  'research',
  'concept',
  'project',
  'task',
  'diary',
  'reflection',
  'personal_operating_profile',
  'method',
  'signal',
  'dashboard',
];

/** 冻结/终态：进入后不再有任何合法流转（03 文档通用约定） */
export const TERMINAL_STATUSES = ['archived', 'cancelled', 'deprecated', 'ignored'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export function isTerminalStatus(status: string): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// 对象 interface（字段名对齐 frontmatter）
// ---------------------------------------------------------------------------

/** 所有 kos 对象的公共字段 */
export interface KosObjectBase {
  type: KosObjectType;
  /** vault 内相对路径 */
  filePath: string;
  /** YYYY-MM-DD；缺失或非法时为 null（该对象不参与时间类指标，通用约定 2） */
  created: string | null;
  tags: string[];
}

export type SourceFormat =
  | 'book'
  | 'paper'
  | 'article'
  | 'video'
  | 'audio'
  | 'podcast'
  | 'report'
  | 'news'
  | 'x_post'
  | 'course';

export const SOURCE_FORMATS: readonly SourceFormat[] = [
  'book',
  'paper',
  'article',
  'video',
  'audio',
  'podcast',
  'report',
  'news',
  'x_post',
  'course',
];

export type SourceStatus =
  | 'captured'
  | 'extracted'
  | 'summarized'
  | 'reviewed'
  | 'linked'
  | 'archived'
  | 'ignored';

export const SOURCE_STATUSES: readonly SourceStatus[] = [
  'captured',
  'extracted',
  'summarized',
  'reviewed',
  'linked',
  'archived',
  'ignored',
];

export interface SourceObject extends KosObjectBase {
  type: 'source';
  status: SourceStatus;
  title?: string;
  format?: SourceFormat;
  author?: string;
  source_url?: string;
  importance?: 'low' | 'medium' | 'high';
  summary_file?: string;
  extract_file?: string;
}

export type ReviewStatus = 'pending' | 'reviewed';
export const REVIEW_STATUSES: readonly ReviewStatus[] = ['pending', 'reviewed'];

export interface ExtractObject extends KosObjectBase {
  type: 'extract';
  review_status: ReviewStatus;
  source?: string;
  extracted_by?: 'ai' | 'human' | 'mixed';
  location?: string;
}

export interface SummaryObject extends KosObjectBase {
  type: 'summary';
  /** AI 产物是否已审核，默认 false */
  reviewed: boolean;
  source?: string;
  generated_by?: 'ai' | 'human' | 'mixed';
}

export type ResearchStatus = 'draft' | 'reviewed' | 'complete' | 'archived';
export const RESEARCH_STATUSES: readonly ResearchStatus[] = ['draft', 'reviewed', 'complete', 'archived'];

export interface ResearchObject extends KosObjectBase {
  type: 'research';
  status: ResearchStatus;
  title?: string;
  question?: string;
  confidence?: 'draft' | 'verified' | 'mature';
  area?: string;
  updated: string | null;
}

export type ConceptStatus = 'draft' | 'verified' | 'mature';
export const CONCEPT_STATUSES: readonly ConceptStatus[] = ['draft', 'verified', 'mature'];

export interface ConceptObject extends KosObjectBase {
  type: 'concept';
  status: ConceptStatus;
  title?: string;
  confidence?: 'draft' | 'verified' | 'mature';
  area?: string;
  updated: string | null;
  aliases: string[];
  source?: string;
}

export type ProjectStatus = 'active' | 'idea' | 'paused' | 'completed' | 'archived' | 'cancelled';
export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  'active',
  'idea',
  'paused',
  'completed',
  'archived',
  'cancelled',
];

export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
export const PRIORITIES: readonly Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4'];

export interface ProjectObject extends KosObjectBase {
  type: 'project';
  status: ProjectStatus;
  title?: string;
  category?: string;
  priority?: Priority;
  area?: string;
  goal?: string;
  current_stage?: string;
  due: string | null;
  updated: string | null;
}

export type TaskStatus = 'todo' | 'doing' | 'done' | 'blocked' | 'cancelled';
export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'done', 'blocked', 'cancelled'];

export interface TaskObject extends KosObjectBase {
  type: 'task';
  status: TaskStatus;
  title?: string;
  /** 指向项目的 wikilink，如 [[30_项目/某项目]] */
  project?: string;
  priority?: Priority;
  due: string | null;
  completed: string | null;
}

export interface DiaryObject extends KosObjectBase {
  type: 'diary';
  /** 日记所属日期（通用约定 5：按 date 计入，与文件创建时间无关） */
  date: string | null;
  day_of_week?: string;
  week_number: number | null;
  mood?: string;
  /** 整数；缺失或非整数为 null（M11 跳过并提示） */
  energy: number | null;
}

export type ReflectionStatus = 'raw' | 'developed' | 'archived';
export const REFLECTION_STATUSES: readonly ReflectionStatus[] = ['raw', 'developed', 'archived'];

export interface ReflectionObject extends KosObjectBase {
  type: 'reflection';
  status: ReflectionStatus;
  title?: string;
  source_diary?: string;
  trigger?: string;
}

export type ProfileStatus = 'draft' | 'reviewed' | 'active' | 'archived';
export const PROFILE_STATUSES: readonly ProfileStatus[] = ['draft', 'reviewed', 'active', 'archived'];

export interface PersonalOperatingProfileObject extends KosObjectBase {
  type: 'personal_operating_profile';
  status: ProfileStatus;
  title?: string;
  confidence?: 'draft' | 'verified' | 'mature';
  updated: string | null;
  reviewed: boolean;
  /** 写入 active 前必须有人确认元数据 */
  human_confirmed?: boolean;
}

export type MethodStatus = 'candidate' | 'usable' | 'trusted' | 'deprecated';
export const METHOD_STATUSES: readonly MethodStatus[] = ['candidate', 'usable', 'trusted', 'deprecated'];

export interface MethodObject extends KosObjectBase {
  type: 'method';
  status: MethodStatus;
  title?: string;
  updated: string | null;
  applicable_scenarios: string[];
  /** 实践验证次数（usable 需 1+，trusted 需 3+） */
  validated_times: number;
}

export type SignalType = 'daily_brief' | 'topic_watch' | 'company_watch' | 'macro_watch';
export const SIGNAL_TYPES: readonly SignalType[] = ['daily_brief', 'topic_watch', 'company_watch', 'macro_watch'];

export interface SignalObject extends KosObjectBase {
  type: 'signal';
  signal_type?: SignalType;
  date: string | null;
  importance?: 'low' | 'medium' | 'high' | 'critical';
  requires_research: boolean;
}

export type DashboardType = 'daily' | 'projects' | 'inbox' | 'radar' | 'concepts' | 'methods';
export const DASHBOARD_TYPES: readonly DashboardType[] = [
  'daily',
  'projects',
  'inbox',
  'radar',
  'concepts',
  'methods',
];

export interface DashboardObject extends KosObjectBase {
  type: 'dashboard';
  dashboard_type?: DashboardType;
  date: string | null;
  auto_generated: boolean;
  /** ISO datetime，保留原串不截断 */
  last_updated?: string;
}

/** 12 种对象的判别联合 */
export type KosObject =
  | SourceObject
  | ExtractObject
  | SummaryObject
  | ResearchObject
  | ConceptObject
  | ProjectObject
  | TaskObject
  | DiaryObject
  | ReflectionObject
  | PersonalOperatingProfileObject
  | MethodObject
  | SignalObject
  | DashboardObject;

/** 按 type 取对应 interface */
export type KosObjectOf<T extends KosObjectType> = Extract<KosObject, { type: T }>;

// ---------------------------------------------------------------------------
// 状态机 + 权限表（02 文档 3.1 节表格的编码）
// ---------------------------------------------------------------------------

/** 承载状态的字段名：大多数对象是 status，extract/summary 例外 */
export type StatusField = 'status' | 'review_status' | 'reviewed';

export interface TransitionRule {
  from: string;
  to: string;
  /** 该流转是否需人确认（弹确认对话框） */
  requiresConfirmation: boolean;
  /** 规范依据说明，确认对话框中展示 */
  note?: string;
}

export interface StateMachine {
  statusField: StatusField;
  /** 全部合法流转边；终态不在任何 from 中出现 */
  transitions: readonly TransitionRule[];
  /**
   * 冻结态集合：进入后无任何出边，legalTransitions 返回空。
   * 注意区别于 TERMINAL_STATUSES：那里是"存活口径"的排除标准；
   * 这里是状态机层面的流转终点（如 concept.mature、task.done 也算冻结，但仍属存活）。
   */
  frozenStates: readonly string[];
  /** 修改需人确认的字段（status 之外的字段级权限，如 project 的 goal/priority） */
  protectedFields: readonly string[];
}

/** 便捷构造一条流转边 */
function tr(from: string, to: string, requiresConfirmation: boolean, note?: string): TransitionRule {
  return note === undefined ? { from, to, requiresConfirmation } : { from, to, requiresConfirmation, note };
}

/** source 主流转链 */
const SOURCE_CHAIN = ['captured', 'extracted', 'summarized', 'reviewed', 'linked', 'archived'];

const sourceTransitions: TransitionRule[] = [];
for (let i = 0; i < SOURCE_CHAIN.length - 1; i++) {
  sourceTransitions.push(tr(SOURCE_CHAIN[i], SOURCE_CHAIN[i + 1], false));
}
// 任意非终态 → ignored（含 reviewed/linked，不含 archived/ignored）
for (const s of SOURCE_CHAIN.slice(0, -1)) {
  sourceTransitions.push(tr(s, 'ignored', false));
}

/** project：active/idea/paused/completed/archived/cancelled 自由流转；archived/cancelled 为终态 */
const PROJECT_FREE: readonly string[] = ['active', 'idea', 'paused', 'completed'];
const projectTransitions: TransitionRule[] = PROJECT_FREE.flatMap((from) =>
  PROJECT_STATUSES.filter((to) => to !== from).map((to) => tr(from, to, false)),
);

export const STATE_MACHINES: Record<KosObjectType, StateMachine | null> = {
  source: {
    statusField: 'status',
    transitions: sourceTransitions,
    frozenStates: ['archived', 'ignored'],
    protectedFields: [],
  },
  extract: {
    statusField: 'review_status',
    transitions: [tr('pending', 'reviewed', true, '摘录审核需人确认')],
    frozenStates: ['reviewed'],
    protectedFields: [],
  },
  summary: {
    statusField: 'reviewed',
    transitions: [tr('false', 'true', true, '摘要审核需人确认')],
    frozenStates: ['true'],
    protectedFields: [],
  },
  research: {
    statusField: 'status',
    transitions: [
      tr('draft', 'reviewed', true, '规范：draft→reviewed 必须人确认'),
      tr('reviewed', 'complete', true, '规范：reviewed→complete 必须人确认'),
      tr('complete', 'archived', false),
    ],
    frozenStates: ['archived'],
    protectedFields: [],
  },
  concept: {
    statusField: 'status',
    transitions: [
      tr('draft', 'verified', true, '规范：AI 不能将 draft 改为 verified/mature，必须人确认'),
      tr('verified', 'mature', true, '规范：concept 晋升必须人确认'),
    ],
    frozenStates: ['mature'],
    protectedFields: [],
  },
  project: {
    statusField: 'status',
    transitions: projectTransitions,
    frozenStates: ['archived', 'cancelled'],
    protectedFields: ['goal', 'priority'],
  },
  task: {
    statusField: 'status',
    transitions: [
      tr('todo', 'doing', false),
      tr('doing', 'done', false),
      tr('todo', 'blocked', false),
      tr('doing', 'blocked', false),
      tr('todo', 'cancelled', false),
      tr('doing', 'cancelled', false),
    ],
    // done/blocked 规范未定义出边，同为流转终点
    frozenStates: ['done', 'blocked', 'cancelled'],
    protectedFields: [],
  },
  diary: null,
  reflection: {
    statusField: 'status',
    transitions: [
      tr('raw', 'developed', true, '规范：raw→developed 需人确认'),
      tr('developed', 'archived', false),
    ],
    frozenStates: ['archived'],
    protectedFields: [],
  },
  personal_operating_profile: {
    statusField: 'status',
    transitions: [
      tr('draft', 'reviewed', true, '规范：画像晋升必须人确认'),
      tr('reviewed', 'active', true, '规范：写入 active 前必须有人确认元数据'),
      tr('active', 'archived', false),
    ],
    frozenStates: ['archived'],
    protectedFields: [],
  },
  method: {
    statusField: 'status',
    transitions: [
      tr('candidate', 'usable', true, '规范：需 1+ 次实践验证（validated_times ≥ 1）'),
      tr('usable', 'trusted', true, '规范：需 3+ 次实践验证（validated_times ≥ 3）'),
      tr('candidate', 'deprecated', false),
      tr('usable', 'deprecated', false),
      tr('trusted', 'deprecated', false),
    ],
    frozenStates: ['deprecated'],
    protectedFields: [],
  },
  signal: null,
  dashboard: null,
};

/** 各类型状态缺失时的默认值（parse 层使用；无状态对象为 undefined） */
export const DEFAULT_STATE: Partial<Record<KosObjectType, string>> = {
  source: 'captured',
  extract: 'pending',
  summary: 'false',
  research: 'draft',
  concept: 'draft',
  project: 'active',
  task: 'todo',
  reflection: 'raw',
  personal_operating_profile: 'draft',
  method: 'candidate',
};

// ---------------------------------------------------------------------------
// 路径前缀归类表（索引层快速过滤用；type 字段才是最终判据）
// ---------------------------------------------------------------------------

export interface PathPrefixRule {
  prefix: string;
  type: KosObjectType;
}

/** 按前缀从长到短排列，命中第一条即返回 */
export const PATH_PREFIX_RULES: readonly PathPrefixRule[] = [
  { prefix: '20_处理区/摘录/', type: 'extract' },
  { prefix: '20_处理区/摘要/', type: 'summary' },
  { prefix: '11_原材料/', type: 'source' },
  { prefix: '21_研究/', type: 'research' },
  { prefix: '22_知识库/', type: 'concept' },
  { prefix: '30_项目/', type: 'project' },
  { prefix: '31_任务/', type: 'task' },
  { prefix: '23_日记/', type: 'diary' },
  { prefix: '24_认知记录/', type: 'reflection' },
  { prefix: '25_个人操作画像/', type: 'personal_operating_profile' },
  { prefix: '40_方法库/', type: 'method' },
  { prefix: '50_信息雷达/', type: 'signal' },
  { prefix: '00_工作台/', type: 'dashboard' },
];

/** 收件箱路径前缀（M13 inbox-zero 徽章用；收件箱文件不是 kos 对象） */
export const INBOX_PREFIX = '10_收件箱/';

/** 按路径前缀快速归类；无法归类返回 null（最终判据仍是 frontmatter 的 type） */
export function classifyByPath(filePath: string): KosObjectType | null {
  for (const rule of PATH_PREFIX_RULES) {
    if (filePath.startsWith(rule.prefix)) return rule.type;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 对象目录映射（个性化布局支持；索引为 type-first，目录仅用于落盘与收件箱识别）
// ---------------------------------------------------------------------------

/**
 * 可在设置中重映射的目录键：收件箱 + 11 类有落盘/归类行为的对象目录。
 * 值为 vault 相对目录，不带首尾斜杠（normalizeObjectDirs 负责归一）。
 * 注：personal_operating_profile 与 dashboard 暂无插件落盘行为，不占键。
 */
export interface ObjectDirs {
  inbox: string;
  source: string;
  extract: string;
  summary: string;
  research: string;
  concept: string;
  method: string;
  project: string;
  task: string;
  diary: string;
  reflection: string;
  radar: string;
}

export const OBJECT_DIR_KEYS = [
  'inbox',
  'source',
  'extract',
  'summary',
  'research',
  'concept',
  'method',
  'project',
  'task',
  'diary',
  'reflection',
  'radar',
] as const;

/** 标准默认值 = framework 标准布局（与 PATH_PREFIX_RULES / INBOX_PREFIX 一致） */
export const DEFAULT_OBJECT_DIRS: ObjectDirs = {
  inbox: '10_收件箱',
  source: '11_原材料',
  extract: '20_处理区/摘录',
  summary: '20_处理区/摘要',
  research: '21_研究',
  concept: '22_知识库',
  method: '40_方法库',
  project: '30_项目',
  task: '31_任务',
  diary: '23_日记',
  reflection: '24_认知记录',
  radar: '50_信息雷达',
};

/**
 * 目录映射归一：逐键取字符串值，trim 并去掉首尾斜杠；
 * 缺失/非字符串/归一后为空串的键回落标准默认值。永不抛异常（兼容旧 data.json）。
 */
export function normalizeObjectDirs(raw: unknown): ObjectDirs {
  const out = { ...DEFAULT_OBJECT_DIRS };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const rec = raw as Record<string, unknown>;
  for (const key of OBJECT_DIR_KEYS) {
    const v = rec[key];
    if (typeof v !== 'string') continue;
    const dir = v.trim().replace(/^\/+|\/+$/g, '');
    if (dir !== '') out[key] = dir;
  }
  return out;
}
