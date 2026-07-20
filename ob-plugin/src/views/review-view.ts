/**
 * review-view.ts — B3 待审核中心（右侧栏）
 *
 * 按类型分组列出 M9 范围的全部待审核项；点击标题打开文件，
 * "通过"按钮调用构造注入的 onApprove（真实写入见 actions/review.ts）。
 */

import type { WorkspaceLeaf } from 'obsidian';
import { pendingReviewList } from '../core/metrics';
import type { KosObject, KosObjectType } from '../core/model';
import { KosView, TYPE_LABELS, objectTitle } from './view-context';
import type { ViewContext } from './view-context';

export const REVIEW_VIEW_TYPE = 'kos-review';

/** 审核通过回调：由 main.ts 注入（真实写入走 actions/review.ts approveReviewObject） */
export type ApproveHandler = (obj: KosObject) => void;

/** 分组展示顺序（对齐 M9 清单） */
const GROUP_ORDER: readonly KosObjectType[] = [
  'summary',
  'extract',
  'research',
  'concept',
  'reflection',
  'method',
  'personal_operating_profile',
];

/** 待审核状态文案（summary/extract 的状态字段特殊，单独处理） */
function statusText(o: KosObject): string {
  if (o.type === 'summary') return 'reviewed=false';
  if (o.type === 'extract') return 'review_status=pending';
  return 'status' in o ? `status=${o.status}` : '';
}

export class ReviewView extends KosView {
  constructor(
    leaf: WorkspaceLeaf,
    ctx: ViewContext,
    private readonly onApprove: ApproveHandler,
  ) {
    super(leaf, ctx);
  }

  getViewType(): string {
    return REVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '待审核中心';
  }

  getIcon(): string {
    return 'badge-check';
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('kos-view', 'kos-review-view');

    const pending = pendingReviewList(this.ctx.index.getAll());
    const header = contentEl.createDiv({ cls: 'kos-view-header' });
    header.createSpan({ cls: 'kos-review-total', text: `待审核 ${pending.length} 项` });

    // 清零占位（触发 review-clear 徽章的逻辑在 P4）
    if (pending.length === 0) {
      contentEl.createDiv({ cls: 'kos-empty', text: '审核清零 🎉' });
      return;
    }

    for (const type of GROUP_ORDER) {
      const items = pending.filter((o) => o.type === type);
      if (items.length === 0) continue;
      const sec = this.section(contentEl, `${TYPE_LABELS[type]}（${items.length}）`);
      for (const o of items) {
        const row = sec.createDiv({ cls: 'kos-review-row' });
        const titleEl = row.createEl('a', { cls: 'kos-review-title', text: objectTitle(o) });
        titleEl.addEventListener('click', () => void this.openFile(o.filePath));
        row.createSpan({ cls: 'kos-tag', text: TYPE_LABELS[o.type] });
        row.createSpan({ cls: 'kos-muted', text: statusText(o) });
        const btn = row.createEl('button', { cls: 'kos-approve-btn', text: '通过' });
        btn.addEventListener('click', () => this.onApprove(o));
      }
    }
  }
}
