/**
 * transitions.ts — 状态流转合法性过滤（B3/B4 的共同地基）
 *
 * 状态值统一用字符串表示；summary 的 reviewed 布尔用 'true'/'false' 表示。
 * 插件不做任何自动流转，这里只回答"人能做哪些流转、哪些要弹确认框"。
 */

import { STATE_MACHINES } from './model';
import type { KosObject } from './model';

/** 一个合法的下一状态 */
export interface TransitionTarget {
  /** 目标状态（字符串形式；summary 为 'true'） */
  to: string;
  /** 是否需人确认（弹确认对话框，展示 note） */
  requiresConfirmation: boolean;
  /** 规范依据说明 */
  note?: string;
}

/**
 * 对象当前状态（字符串形式）。
 * 无状态机对象（diary/signal/dashboard）返回 null。
 */
export function currentState(obj: KosObject): string | null {
  switch (obj.type) {
    case 'extract':
      return obj.review_status;
    case 'summary':
      return String(obj.reviewed);
    case 'diary':
    case 'signal':
    case 'dashboard':
      return null;
    default:
      return obj.status;
  }
}

/**
 * 该对象允许的下一状态列表。
 * 无状态机对象、冻结态（archived/cancelled/deprecated/ignored 及各类型流转终点）返回空列表。
 */
export function legalTransitions(obj: KosObject): TransitionTarget[] {
  const machine = STATE_MACHINES[obj.type];
  if (!machine) return [];
  const state = currentState(obj);
  if (state === null) return [];
  if (machine.frozenStates.includes(state)) return [];
  return machine.transitions
    .filter((t) => t.from === state)
    .map((t) => {
      const target: TransitionTarget = { to: t.to, requiresConfirmation: t.requiresConfirmation };
      if (t.note !== undefined) target.note = t.note;
      return target;
    });
}

/** 校验单次流转合法性；target 为字符串形式（summary 用 'true'） */
export function canTransition(obj: KosObject, target: string): boolean {
  return legalTransitions(obj).some((t) => t.to === target);
}

/** 该对象修改指定字段是否需人确认（如 project 的 goal/priority） */
export function fieldRequiresConfirmation(obj: KosObject, field: string): boolean {
  const machine = STATE_MACHINES[obj.type];
  return machine !== null && machine.protectedFields.includes(field);
}
