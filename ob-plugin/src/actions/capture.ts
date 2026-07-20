/**
 * capture.ts — B1 快速捕获
 *
 * 写入 {objectDirs.inbox}/{标题}.md（默认 10_收件箱，可在设置页改）：收件箱笔记
 * 无 frontmatter 要求，正文直接写入。
 * 已存在同名文件时报错不覆盖（写入边界见 02 文档 3.4 节）。
 */

import { App, Modal, Notice, Setting } from 'obsidian';
import type { ObjectDirs } from '../core/model';
import { ensureFolder } from './create';

/** 捕获类型：仅作正文首行的归类提示，无 frontmatter 结构 */
export const CAPTURE_TYPES = {
  note: '普通笔记',
  idea: '想法',
  clip: '摘录',
  todo: '待办',
} as const;
export type CaptureType = keyof typeof CAPTURE_TYPES;

/** openCaptureModal 的预填值 */
export interface CapturePrefill {
  title?: string;
  body?: string;
  type?: CaptureType;
}

/** 文件名清洗：去掉 Obsidian/文件系统非法字符，压缩空白 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class CaptureModal extends Modal {
  private title: string;
  private body: string;
  private type: CaptureType;

  constructor(
    app: App,
    private readonly dirs: ObjectDirs,
    prefill?: CapturePrefill,
  ) {
    super(app);
    this.title = prefill?.title ?? '';
    this.body = prefill?.body ?? '';
    this.type = prefill?.type ?? 'note';
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('kos-modal');
    contentEl.createEl('h3', { text: '快速捕获到收件箱' });

    new Setting(contentEl).setName('标题').addText((text) => {
      text.setPlaceholder('笔记标题').setValue(this.title).onChange((v) => (this.title = v));
      text.inputEl.focus();
    });

    new Setting(contentEl).setName('类型').addDropdown((dropdown) => {
      for (const [key, label] of Object.entries(CAPTURE_TYPES)) dropdown.addOption(key, label);
      dropdown.setValue(this.type).onChange((v) => (this.type = v as CaptureType));
    });

    new Setting(contentEl).setName('正文').addTextArea((area) => {
      area.setPlaceholder('直接写入正文（无 frontmatter）').setValue(this.body).onChange((v) => (this.body = v));
      area.inputEl.rows = 8;
      area.inputEl.addClass('kos-capture-body');
    });

    const row = contentEl.createDiv({ cls: 'kos-modal-buttons' });
    const ok = row.createEl('button', { cls: 'mod-cta', text: '写入收件箱' });
    ok.addEventListener('click', () => void this.submit());
    const cancel = row.createEl('button', { text: '取消' });
    cancel.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async submit(): Promise<void> {
    const name = sanitizeFileName(this.title);
    if (name === '') {
      new Notice('标题为空或全是非法字符');
      return;
    }
    const path = `${this.dirs.inbox}/${name}.md`;
    if (await this.app.vault.adapter.exists(path)) {
      new Notice(`已存在同名文件，未覆盖：${path}`);
      return;
    }
    const lines = [`# ${this.title.trim() || name}`, ''];
    if (this.type !== 'note') lines.push(`类型：${CAPTURE_TYPES[this.type]}`, '');
    if (this.body.trim() !== '') lines.push(this.body.trim(), '');
    await ensureFolder(this.app, this.dirs.inbox);
    await this.app.vault.create(path, lines.join('\n'));
    new Notice(`已捕获：${path}`);
    this.close();
  }
}

/** B1 入口：打开快速捕获 Modal（支持初始值预填） */
export function openCaptureModal(app: App, dirs: ObjectDirs, prefill?: CapturePrefill): void {
  new CaptureModal(app, dirs, prefill).open();
}
