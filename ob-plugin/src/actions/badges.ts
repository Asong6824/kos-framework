/**
 * badges.ts — A6 徽章系统接线（M13）
 *
 * 触发时机：KosIndex onDidChange（内部已 debounce 200ms）。
 * 每次评估：evaluateBadges 求当前达成集合 → newBadges 与 data.json 已解锁集合求差 →
 * 新解锁：recordBadge + badgeNotice 弹层 + Notice；可重复徽章额外累加计数器。
 *
 * 可重复徽章（inbox-zero / review-clear）只认"从非零回到 0"：
 * 启动时用当前观察值初始化 prev，启动即 0 不算达成（任务约定，覆盖 core 的
 * "首次观察到 0" 语义）；启动非零后归零才触发。
 * settings.enableBadges 为 false 时跳过动画与 Notice，仍照常记录。
 */

import { Notice } from 'obsidian';
import { activityStreak, evaluateBadges, newBadges, pendingReviewCount } from '../core/metrics';
import type { BadgeId, MetricSettings } from '../core/metrics';
import type { KosIndex } from '../data/index';
import { KosDataStore, localToday } from '../data/store';
import type { KosSettings } from '../settings';
import { BADGE_NAMES, badgeNotice } from '../views/components';

/** 解锁提示驻留时长（ms） */
const CELEBRATION_MS = 5000;

export class BadgeWatcher {
  /** 上一次观察值；启动时以当前值初始化（见文件头"可重复徽章"约定） */
  private prevInbox: number;
  private prevPending: number;

  constructor(
    private readonly index: KosIndex,
    private readonly store: KosDataStore,
    private readonly getSettings: () => KosSettings,
    private readonly getMetricSettings: () => MetricSettings,
  ) {
    this.prevInbox = this.index.inboxFiles().length;
    this.prevPending = pendingReviewCount(this.index.getAll()).total;
  }

  /** onDidChange 后调用：评估 + 落盘 + 弹层 */
  async check(): Promise<void> {
    const objects = this.index.getAll();
    const today = localToday();
    const settings = this.getSettings();
    const ms = this.getMetricSettings();

    const inboxCount = this.index.inboxFiles().length;
    const pending = pendingReviewCount(objects).total;
    const earned = evaluateBadges({
      objects,
      currentStreak: activityStreak(objects, today, ms).current,
      inboxFileCount: inboxCount,
      prevInboxFileCount: this.prevInbox,
      pendingReview: pending,
      prevPendingReview: this.prevPending,
    });
    this.prevInbox = inboxCount;
    this.prevPending = pending;

    const fresh = newBadges(earned, this.store.pluginData.badges);
    if (fresh.length === 0) return;

    for (const id of fresh) {
      this.store.recordBadge(id, today);
      // 可重复徽章累加次数（recordBadge 只记 null）
      if (id === 'inbox-zero') this.store.incrementCounter('inboxZeroCount');
      else if (id === 'review-clear') this.store.incrementCounter('reviewClearCount');
      if (settings.enableBadges) this.celebrate(id);
    }
    await this.store.save();
  }

  /** 解锁动画：badgeNotice 浮层 + Notice；enableBadges=false 时调用方已跳过 */
  private celebrate(id: BadgeId): void {
    const el = badgeNotice(document.body, id);
    el.addClass('kos-badge-floating');
    window.setTimeout(() => el.remove(), CELEBRATION_MS);
    new Notice(`徽章解锁：${BADGE_NAMES[id]}`);
  }
}
