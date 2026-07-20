/**
 * parse.ts — frontmatter 原始对象 → 强类型 KosObject
 *
 * 输入是 Obsidian metadataCache 已解析好的 frontmatter（不自行解析 YAML）。
 * 容错原则：字段类型不对时按缺失处理，给默认值或 null，绝不抛异常。
 */

import {
  CONCEPT_STATUSES,
  DASHBOARD_TYPES,
  KOS_OBJECT_TYPES,
  METHOD_STATUSES,
  PRIORITIES,
  PROFILE_STATUSES,
  PROJECT_STATUSES,
  REFLECTION_STATUSES,
  RESEARCH_STATUSES,
  REVIEW_STATUSES,
  SIGNAL_TYPES,
  SOURCE_FORMATS,
  SOURCE_STATUSES,
  TASK_STATUSES,
} from './model';
import type {
  ConceptObject,
  DashboardObject,
  DiaryObject,
  ExtractObject,
  KosObject,
  KosObjectType,
  MethodObject,
  PersonalOperatingProfileObject,
  ProjectObject,
  ReflectionObject,
  ResearchObject,
  SignalObject,
  SourceObject,
  SummaryObject,
  TaskObject,
} from './model';

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** 日期归一化：取前 10 位（YYYY-MM-DD）；非法输入返回 null */
function asDate(v: unknown): string | null {
  if (typeof v === 'string') {
    return DATE_RE.test(v) ? v.slice(0, 10) : null;
  }
  // 防御：某些 YAML 解析器会把 date 变成 Date 对象，按本地日历日取
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

/** 字符串字段：非字符串按缺失处理 */
function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** tags 归一为 string[]：数组过滤非字符串；单字符串提升为数组；其余给 [] */
function asStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v.length > 0) return [v];
  return [];
}

/** 枚举字段：不在合法值集合内按缺失处理，返回默认值 */
function asEnum<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : def;
}

/** 可选枚举字段：缺失/非法给 undefined */
function asOptEnum<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** 整数字段：仅接受真正的整数，其余返回 null（M11：非整数按字符串忽略） */
function asInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

/** 非负整数字段（validated_times 等），默认 0 */
function asNonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

/** 布尔字段：非布尔给默认值 */
function asBool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}

const GENERATED_BY = ['ai', 'human', 'mixed'] as const;
const CONFIDENCE = ['draft', 'verified', 'mature'] as const;
const IMPORTANCE = ['low', 'medium', 'high'] as const;
const SIGNAL_IMPORTANCE = ['low', 'medium', 'high', 'critical'] as const;

/**
 * 解析 frontmatter 为强类型 KosObject。
 * type 缺失或不识别时返回 null（该文件不进索引）。
 */
export function parseKosObject(raw: Record<string, unknown>, filePath: string): KosObject | null {
  const type = asOptEnum(raw.type, KOS_OBJECT_TYPES) as KosObjectType | undefined;
  if (!type) return null;

  const base = {
    filePath,
    created: asDate(raw.created),
    tags: asStrArray(raw.tags),
  };

  switch (type) {
    case 'source': {
      const obj: SourceObject = {
        ...base,
        type,
        status: asEnum(raw.status, SOURCE_STATUSES, 'captured'),
        title: asStr(raw.title),
        format: asOptEnum(raw.format, SOURCE_FORMATS),
        author: asStr(raw.author),
        source_url: asStr(raw.source_url),
        importance: asOptEnum(raw.importance, IMPORTANCE),
        summary_file: asStr(raw.summary_file),
        extract_file: asStr(raw.extract_file),
      };
      return obj;
    }
    case 'extract': {
      const obj: ExtractObject = {
        ...base,
        type,
        review_status: asEnum(raw.review_status, REVIEW_STATUSES, 'pending'),
        source: asStr(raw.source),
        extracted_by: asOptEnum(raw.extracted_by, GENERATED_BY),
        location: asStr(raw.location),
      };
      return obj;
    }
    case 'summary': {
      const obj: SummaryObject = {
        ...base,
        type,
        reviewed: asBool(raw.reviewed, false),
        source: asStr(raw.source),
        generated_by: asOptEnum(raw.generated_by, GENERATED_BY),
      };
      return obj;
    }
    case 'research': {
      const obj: ResearchObject = {
        ...base,
        type,
        status: asEnum(raw.status, RESEARCH_STATUSES, 'draft'),
        title: asStr(raw.title),
        question: asStr(raw.question),
        confidence: asOptEnum(raw.confidence, CONFIDENCE),
        area: asStr(raw.area),
        updated: asDate(raw.updated),
      };
      return obj;
    }
    case 'concept': {
      const obj: ConceptObject = {
        ...base,
        type,
        status: asEnum(raw.status, CONCEPT_STATUSES, 'draft'),
        title: asStr(raw.title),
        confidence: asOptEnum(raw.confidence, CONFIDENCE),
        area: asStr(raw.area),
        updated: asDate(raw.updated),
        aliases: asStrArray(raw.aliases),
        source: asStr(raw.source),
      };
      return obj;
    }
    case 'project': {
      const obj: ProjectObject = {
        ...base,
        type,
        status: asEnum(raw.status, PROJECT_STATUSES, 'active'),
        title: asStr(raw.title),
        category: asStr(raw.category),
        priority: asOptEnum(raw.priority, PRIORITIES),
        area: asStr(raw.area),
        goal: asStr(raw.goal),
        current_stage: asStr(raw.current_stage),
        due: asDate(raw.due),
        updated: asDate(raw.updated),
      };
      return obj;
    }
    case 'task': {
      const obj: TaskObject = {
        ...base,
        type,
        status: asEnum(raw.status, TASK_STATUSES, 'todo'),
        title: asStr(raw.title),
        project: asStr(raw.project),
        priority: asOptEnum(raw.priority, PRIORITIES),
        due: asDate(raw.due),
        completed: asDate(raw.completed),
      };
      return obj;
    }
    case 'diary': {
      const obj: DiaryObject = {
        ...base,
        type,
        date: asDate(raw.date),
        day_of_week: asStr(raw.day_of_week),
        week_number: asInt(raw.week_number),
        mood: asStr(raw.mood),
        energy: asInt(raw.energy),
      };
      return obj;
    }
    case 'reflection': {
      const obj: ReflectionObject = {
        ...base,
        type,
        status: asEnum(raw.status, REFLECTION_STATUSES, 'raw'),
        title: asStr(raw.title),
        source_diary: asStr(raw.source_diary),
        trigger: asStr(raw.trigger),
      };
      return obj;
    }
    case 'personal_operating_profile': {
      const obj: PersonalOperatingProfileObject = {
        ...base,
        type,
        status: asEnum(raw.status, PROFILE_STATUSES, 'draft'),
        title: asStr(raw.title),
        confidence: asOptEnum(raw.confidence, CONFIDENCE),
        updated: asDate(raw.updated),
        reviewed: asBool(raw.reviewed, false),
        human_confirmed: typeof raw.human_confirmed === 'boolean' ? raw.human_confirmed : undefined,
      };
      return obj;
    }
    case 'method': {
      const obj: MethodObject = {
        ...base,
        type,
        status: asEnum(raw.status, METHOD_STATUSES, 'candidate'),
        title: asStr(raw.title),
        updated: asDate(raw.updated),
        applicable_scenarios: asStrArray(raw.applicable_scenarios),
        validated_times: asNonNegInt(raw.validated_times),
      };
      return obj;
    }
    case 'signal': {
      const obj: SignalObject = {
        ...base,
        type,
        signal_type: asOptEnum(raw.signal_type, SIGNAL_TYPES),
        date: asDate(raw.date),
        importance: asOptEnum(raw.importance, SIGNAL_IMPORTANCE),
        requires_research: asBool(raw.requires_research, false),
      };
      return obj;
    }
    case 'dashboard': {
      const obj: DashboardObject = {
        ...base,
        type,
        dashboard_type: asOptEnum(raw.dashboard_type, DASHBOARD_TYPES),
        date: asDate(raw.date),
        auto_generated: asBool(raw.auto_generated, true),
        last_updated: asStr(raw.last_updated),
      };
      return obj;
    }
  }
}
