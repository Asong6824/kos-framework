/**
 * review.ts — B3 审核通过写入
 *
 * "通过" = 按状态机走到下一个已确认态，与 B4 共用 applyTransition 通路（含确认框）：
 * - extract：pending → reviewed
 * - summary：reviewed false → true（流转目标 'true' 由 applyTransition 映射回布尔）
 * - research/concept/reflection/method/personal_operating_profile：
 *   取 legalTransitions 的第一个目标（各类型状态机表把晋升流转排在首位）
 */

import { App, Notice } from 'obsidian';
import { isPendingReview } from '../core/metrics';
import type { KosObject } from '../core/model';
import { legalTransitions } from '../core/transitions';
import type { KosSettings } from '../settings';
import { objectTitle } from '../views/view-context';
import { applyTransition } from './transition';
import type { TransitionOperation } from './transition';

/** 审核"通过"回调（ReviewView 注入用）；返回是否实际写入 */
export async function approveReviewObject(
  app: App,
  obj: KosObject,
  settings: KosSettings,
  operation?: TransitionOperation,
): Promise<boolean> {
  if (!isPendingReview(obj)) {
    new Notice(`「${objectTitle(obj)}」当前不在待审核状态`);
    return false;
  }
  // extract/summary 的目标状态固定；其余取第一个晋升流转
  const target =
    obj.type === 'extract' ? 'reviewed' : obj.type === 'summary' ? 'true' : (legalTransitions(obj)[0]?.to ?? null);
  if (target === null) {
    new Notice(`「${objectTitle(obj)}」没有可用的晋升流转`);
    return false;
  }
  return applyTransition(app, obj, target, settings, operation);
}
