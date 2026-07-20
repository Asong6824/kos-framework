/**
 * view-context.ts — 视图层共享上下文与基类
 *
 * ViewContext 由 main.ts 构造注入：视图只依赖这个窄接口，不反向依赖插件类，
 * 避免 main ↔ views 循环引用。
 */

import { ItemView, TFile } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type { MetricSettings } from '../core/metrics';
import type { KosObject, KosObjectType } from '../core/model';
import type { KosIndex } from '../data/index';
import type { KosDataStore } from '../data/store';
import { localToday } from '../data/store';

/** 注入视图的依赖：索引、快照存储、当前指标设置（读取时求值，跟随设置变更） */
export interface ViewContext {
  index: KosIndex;
  store: KosDataStore;
  metricSettings(): MetricSettings;
}

/** 对象类型中文名（与 vault 文档术语对齐） */
export const TYPE_LABELS: Record<KosObjectType, string> = {
  source: '输入源',
  extract: '摘录',
  summary: '摘要',
  research: '研究',
  concept: '概念',
  project: '项目',
  task: '任务',
  diary: '日记',
  reflection: '认知记录',
  personal_operating_profile: '个人画像',
  method: '方法',
  signal: '信号',
  dashboard: '工作台',
};

/** 对象显示标题：title 字段优先，退化为去扩展名的文件名 */
export function objectTitle(o: KosObject): string {
  const titled = o as KosObject & { title?: string };
  if (titled.title && titled.title.length > 0) return titled.title;
  const base = o.filePath.slice(o.filePath.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
}

/** kos 视图基类：统一持有 ctx、提供打开文件/今日日期，onOpen 自动 render */
export abstract class KosView extends ItemView {
  protected constructor(
    leaf: WorkspaceLeaf,
    protected readonly ctx: ViewContext,
  ) {
    super(leaf);
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  /** 重渲染入口：main.ts 在索引变更时统一调用 */
  abstract render(): void;

  /** 本地今天 YYYY-MM-DD（口径同 store.localToday） */
  protected today(): string {
    return localToday();
  }

  /** 点击标题打开对应笔记（中央新 tab） */
  protected async openFile(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf('tab').openFile(file);
    }
  }

  /** 带标题的区块容器 */
  protected section(parent: HTMLElement, title: string): HTMLElement {
    const sec = parent.createDiv({ cls: 'kos-section' });
    sec.createEl('h3', { cls: 'kos-section-title', text: title });
    return sec;
  }
}
