/**
 * index.ts — KosIndex：metadataCache 驱动的增量索引
 *
 * 数据源：vault 事件 + metadataCache 已解析的 frontmatter（不自行解析 YAML）。
 * 归类：type-first —— frontmatter 的 type 字段是唯一判据，路径不做归类门槛
 * （02 文档 3.2 节；classifyByPath 保留在 core 作辅助，索引层不再使用）。
 * 变更：debounce 200ms 后只重建受影响文件，再向订阅者发变更事件。
 */

import { App, TFile } from 'obsidian';
import type { EventRef } from 'obsidian';
import type { KosObject, KosObjectOf, KosObjectType, ObjectDirs, ProjectObject } from '../core/model';
import { parseKosObject } from '../core/parse';
import { projectProgress } from '../core/metrics';
import type { MetricSettings, ProjectProgress } from '../core/metrics';

/** 增量重建 debounce 间隔（02 文档 3.2 节） */
const DEBOUNCE_MS = 200;

/**
 * 系统区前缀：90_系统/模板 等文件携带合法 type frontmatter（供创建向导读取），
 * 但不是 kos 对象实例，必须排除在索引外，否则模板会污染全部指标。
 */
const SYSTEM_DIR_PREFIX = '90_系统/';

/** 项目页正文中承载 checkbox 任务的章节标题（对齐 vault 项目模板与 harness） */
const PROJECT_TASK_SECTION = '当前任务';

/** 索引变更回调：参数为本批受影响的文件路径 */
export type KosIndexChangeListener = (changedPaths: string[]) => void;

/** 项目页"当前任务"章节的 checkbox 统计 */
export interface CheckboxStats {
  done: number;
  total: number;
}

/**
 * 提取"当前任务"章节的 checkbox 统计（- [ ]/- [x]，大小写 x 均算完成）。
 * 章节终结于同级或更高级标题，口径对齐 harness section_text。
 */
function extractCheckboxStats(content: string): CheckboxStats {
  const stats: CheckboxStats = { done: 0, total: 0 };
  let inSection = false;
  let sectionLevel = 0;
  for (const line of content.split('\n')) {
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      if (inSection && heading[1].length <= sectionLevel) break;
      inSection = heading[2] === PROJECT_TASK_SECTION;
      sectionLevel = heading[1].length;
      continue;
    }
    if (!inSection) continue;
    const task = /^\s*[-*+]\s+\[(.)\]/.exec(line);
    if (task) {
      stats.total += 1;
      if (task[1] === 'x' || task[1] === 'X') stats.done += 1;
    }
  }
  return stats;
}

export class KosIndex {
  private readonly objects = new Map<string, KosObject>();
  private readonly inbox = new Set<string>();
  private readonly checkboxes = new Map<string, CheckboxStats>();
  private readonly listeners = new Set<KosIndexChangeListener>();
  private readonly pending = new Set<string>();
  private vaultRefs: EventRef[] = [];
  private metaRefs: EventRef[] = [];
  private timer: number | null = null;
  private fullRebuildPending = false;

  constructor(
    private readonly app: App,
    /** 目录映射 getter（注入方式同 ViewContext.metricSettings，读取时求值跟随设置变更） */
    private readonly objectDirs: () => ObjectDirs,
  ) {}

  /** 全量构建并开启增量监听（onload 时调用一次） */
  async build(): Promise<void> {
    await this.rebuildAll();
    this.startWatching();
  }

  /** 注销监听与定时器（onunload 时调用） */
  dispose(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    for (const ref of this.vaultRefs) this.app.vault.offref(ref);
    for (const ref of this.metaRefs) this.app.metadataCache.offref(ref);
    this.vaultRefs = [];
    this.metaRefs = [];
    this.pending.clear();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------
  // 订阅
  // ---------------------------------------------------------------------------

  onDidChange(cb: KosIndexChangeListener): void {
    this.listeners.add(cb);
  }

  offDidChange(cb: KosIndexChangeListener): void {
    this.listeners.delete(cb);
  }

  // ---------------------------------------------------------------------------
  // 查询
  // ---------------------------------------------------------------------------

  /** 全部已归类对象（插入序） */
  getAll(): KosObject[] {
    return [...this.objects.values()];
  }

  /** 按类型过滤 */
  byType<T extends KosObjectType>(type: T): KosObjectOf<T>[] {
    return this.getAll().filter((o): o is KosObjectOf<T> => o.type === type);
  }

  /** 收件箱文件（objectDirs.inbox 下的 md 文件，无 frontmatter 也计入；非 kos 对象，M13 用） */
  inboxFiles(): string[] {
    return [...this.inbox];
  }

  getObject(filePath: string): KosObject | undefined {
    return this.objects.get(filePath);
  }

  /**
   * M10 用：core projectProgress 只统计 31_任务 的 task 对象，
   * 此处叠加项目页"当前任务"章节 checkbox 的 done/total。
   */
  mergedProjectProgress(project: ProjectObject, today: string, settings?: MetricSettings): ProjectProgress {
    const cb = this.checkboxes.get(project.filePath) ?? { done: 0, total: 0 };
    const base = projectProgress(this.getAll(), today, settings).find((p) => p.filePath === project.filePath);
    if (!base) {
      // 防御：对象不在索引中（调用方传了外部对象），仅返回 checkbox 统计
      return {
        filePath: project.filePath,
        title: project.title ?? project.filePath,
        total: cb.total,
        done: cb.done,
        progress: cb.total > 0 ? cb.done / cb.total : null,
        stale: null,
        daysSinceUpdate: null,
      };
    }
    const total = base.total + cb.total;
    const done = base.done + cb.done;
    return { ...base, total, done, progress: total > 0 ? done / total : null };
  }

  // ---------------------------------------------------------------------------
  // 索引内部
  // ---------------------------------------------------------------------------

  private async rebuildAll(): Promise<void> {
    this.objects.clear();
    this.inbox.clear();
    this.checkboxes.clear();
    await Promise.all(this.app.vault.getMarkdownFiles().map((f) => this.indexFile(f)));
  }

  /** 单文件（重）建索引：先移除旧条目，再按当前状态归类 */
  private async indexFile(file: TFile): Promise<void> {
    const path = file.path;
    this.removePath(path);
    // 收件箱单独跟踪：收件箱文件不是 kos 对象（可无 frontmatter），优先于 type 判定
    if (path.startsWith(`${this.objectDirs().inbox}/`)) {
      this.inbox.add(path);
      return;
    }
    if (path.startsWith(SYSTEM_DIR_PREFIX)) return;
    // type-first：不再用 classifyByPath 当门槛（个性化目录布局下路径不可假设）。
    // 性能：metadataCache 已为全部 md 文件解析好 frontmatter，getFileCache 是 O(1) 查表，
    // 遍历全部文件与先按路径过滤的成本同阶，因此直接遍历可接受。
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) return;
    const obj = parseKosObject(frontmatter, path);
    if (!obj) return;
    this.objects.set(path, obj);
    if (obj.type === 'project') {
      const content = await this.app.vault.cachedRead(file);
      this.checkboxes.set(path, extractCheckboxStats(content));
    }
  }

  /** 按路径重建；文件已删除/非 md 时仅移除旧条目 */
  private async reindexPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile && file.extension === 'md') {
      await this.indexFile(file);
    } else {
      this.removePath(path);
    }
  }

  private removePath(path: string): void {
    this.objects.delete(path);
    this.inbox.delete(path);
    this.checkboxes.delete(path);
  }

  // ---------------------------------------------------------------------------
  // 增量监听
  // ---------------------------------------------------------------------------

  private startWatching(): void {
    if (this.vaultRefs.length > 0) return;
    const { vault, metadataCache } = this.app;
    this.vaultRefs.push(
      vault.on('create', (f) => {
        if (f instanceof TFile) this.schedule(f.path);
        else this.scheduleFullRebuild(); // 文件夹事件：保守全量重建（罕见）
      }),
      vault.on('modify', (f) => {
        if (f instanceof TFile) this.schedule(f.path);
      }),
      vault.on('delete', (f) => {
        if (f instanceof TFile) this.schedule(f.path);
        else this.scheduleFullRebuild();
      }),
      vault.on('rename', (f, oldPath) => {
        if (f instanceof TFile) {
          this.schedule(oldPath); // 旧路径条目移除
          this.schedule(f.path);
        } else {
          this.scheduleFullRebuild();
        }
      }),
    );
    this.metaRefs.push(metadataCache.on('changed', (f) => this.schedule(f.path)));
  }

  private schedule(path: string): void {
    this.pending.add(path);
    this.resetTimer();
  }

  private scheduleFullRebuild(): void {
    this.fullRebuildPending = true;
    this.resetTimer();
  }

  private resetTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  /** debounce 到点：只重建受影响文件（或标记的全量），再发变更事件 */
  private async flush(): Promise<void> {
    let changed: string[];
    if (this.fullRebuildPending) {
      this.fullRebuildPending = false;
      this.pending.clear();
      await this.rebuildAll();
      changed = [...this.objects.keys(), ...this.inbox];
    } else {
      changed = [...this.pending];
      this.pending.clear();
      if (changed.length === 0) return;
      for (const path of changed) await this.reindexPath(path);
    }
    for (const cb of this.listeners) cb(changed);
  }
}
