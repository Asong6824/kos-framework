import { App, Modal, Notice, Setting } from 'obsidian';
import { SOURCE_FORMATS } from '../core/model';
import type { ObjectDirs, SourceFormat } from '../core/model';

export type CreateKind = 'project' | 'concept' | 'method' | 'task' | 'source';

export interface CreateExtra {
  goal?: string;
  priority?: string;
  format?: SourceFormat;
}

export type CreateObjectOperation = (
  kind: CreateKind,
  title: string,
  dirs: ObjectDirs,
  extra: CreateExtra,
) => Promise<string | null>;

const LABELS: Record<CreateKind, string> = {
  project: '项目', concept: '概念', method: '方法', task: '任务', source: '输入源',
};

const FORMAT_LABELS: Record<SourceFormat, string> = {
  book: '书籍', paper: '论文', article: '文章', video: '视频', audio: '音频', podcast: '播客',
  report: '研报', news: '新闻', x_post: '帖子', course: '课程',
};

/** Folder creation remains a Vault UI primitive used by quick capture, not an object operation. */
export async function ensureFolder(app: App, dir: string): Promise<void> {
  let current = '';
  for (const part of dir.split('/')) {
    current = current ? `${current}/${part}` : part;
    if (!(await app.vault.adapter.exists(current))) await app.vault.createFolder(current);
  }
}

class CreateModal extends Modal {
  private title = '';
  private goal = '';
  private priority = 'P2';
  private format: SourceFormat = 'article';

  constructor(
    app: App,
    private readonly kind: CreateKind,
    private readonly dirs: ObjectDirs,
    private readonly operation: CreateObjectOperation,
  ) {
    super(app);
  }

  onOpen(): void {
    const label = LABELS[this.kind];
    this.contentEl.addClass('kos-modal');
    this.contentEl.createEl('h3', { text: `新建${label}` });
    new Setting(this.contentEl).setName('标题').addText((text) => {
      text.setPlaceholder(`${label}标题`).onChange((value) => (this.title = value));
      text.inputEl.focus();
    });
    if (this.kind === 'project') {
      new Setting(this.contentEl).setName('目标').addText((text) => text.onChange((value) => (this.goal = value)));
      new Setting(this.contentEl).setName('优先级').addDropdown((dropdown) => dropdown
        .addOptions({ P0: 'P0', P1: 'P1', P2: 'P2', P3: 'P3', P4: 'P4' })
        .setValue(this.priority)
        .onChange((value) => (this.priority = value)));
    }
    if (this.kind === 'source') {
      new Setting(this.contentEl).setName('格式').addDropdown((dropdown) => {
        for (const format of SOURCE_FORMATS) dropdown.addOption(format, `${format}（${FORMAT_LABELS[format]}）`);
        dropdown.setValue(this.format).onChange((value) => (this.format = value as SourceFormat));
      });
    }
    const row = this.contentEl.createDiv({ cls: 'kos-modal-buttons' });
    const create = row.createEl('button', { cls: 'mod-cta', text: '创建' });
    create.addEventListener('click', () => {
      create.disabled = true;
      const extra: CreateExtra = this.kind === 'project'
        ? { goal: this.goal, priority: this.priority }
        : this.kind === 'source' ? { format: this.format } : {};
      void this.operation(this.kind, this.title, this.dirs, extra).then((path) => {
        if (!path) return;
        this.close();
        window.setTimeout(() => void this.app.workspace.openLinkText(path, '', false), 100);
      }).catch((error) => {
        create.disabled = false;
        new Notice(error instanceof Error ? error.message : String(error));
      });
    });
    row.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export function openCreateModal(
  app: App,
  kind: CreateKind,
  dirs: ObjectDirs,
  operation: CreateObjectOperation,
): void {
  new CreateModal(app, kind, dirs, operation).open();
}
