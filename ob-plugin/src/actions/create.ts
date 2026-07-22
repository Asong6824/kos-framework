import { App, Modal, Notice, Setting } from 'obsidian';
import { SOURCE_FORMATS } from '../core/model';
import type { ObjectDirs, SourceFormat } from '../core/model';

export type CreateKind = 'goal' | 'project' | 'concept' | 'method' | 'task' | 'source';

export interface CreateExtra {
  goal?: string;
  priority?: string;
  format?: SourceFormat;
  period?: string;
  allocation_weight?: number;
  metric?: string[];
  primary_goal?: string;
  goal_alignment?: 'direct' | 'enabling' | 'exploratory' | 'off_goal' | 'conflicting';
  process_metric?: string[];
  result_metric?: string[];
  projects?: string[];
  estimate_minutes?: number;
  energy?: 'low' | 'medium' | 'high';
  work_mode?: 'deep' | 'shallow' | 'collaborative' | 'administrative';
  growth_mode?: 'neutral' | 'practice' | 'stretch';
}

export type CreateObjectOperation = (
  kind: CreateKind,
  title: string,
  dirs: ObjectDirs,
  extra: CreateExtra,
) => Promise<string | null>;

const LABELS: Record<CreateKind, string> = {
  goal: '半年目标', project: '项目', concept: '概念', method: '方法', task: '任务', source: '输入源',
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
  private priority = 'P2';
  private format: SourceFormat = 'article';
  private period = `${new Date().getFullYear()}-${new Date().getMonth() < 6 ? 'H1' : 'H2'}`;
  private allocationWeight = 0;
  private metric = '';
  private primaryGoal = '';
  private goalAlignment: NonNullable<CreateExtra['goal_alignment']> = 'off_goal';
  private processMetric = '';
  private resultMetric = '';
  private taskProjects = '';
  private estimateMinutes = 30;
  private taskEnergy: NonNullable<CreateExtra['energy']> = 'medium';
  private taskWorkMode: NonNullable<CreateExtra['work_mode']> = 'shallow';

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
	if (this.kind === 'goal') {
		new Setting(this.contentEl).setName('周期').setDesc('格式：YYYY-H1 或 YYYY-H2').addText((text) =>
			text.setValue(this.period).onChange((value) => (this.period = value.trim())),
		);
		new Setting(this.contentEl).setName('投入占比').setDesc('草稿可为 0；激活时当前周期合计必须为 100').addText((text) =>
			text.setValue(String(this.allocationWeight)).onChange((value) => (this.allocationWeight = Number(value))),
		);
		new Setting(this.contentEl).setName('量化指标').addText((text) => text.onChange((value) => (this.metric = value.trim())));
	}
    if (this.kind === 'project') {
		new Setting(this.contentEl).setName('主要目标').addText((text) => text.onChange((value) => (this.primaryGoal = value.trim())));
		new Setting(this.contentEl).setName('目标支持度').addDropdown((dropdown) => dropdown
			.addOptions({ direct: '直接支持', enabling: '能力/基础支持', exploratory: '探索性', off_goal: '目标外', conflicting: '目标冲突' })
			.setValue(this.goalAlignment)
			.onChange((value) => (this.goalAlignment = value as NonNullable<CreateExtra['goal_alignment']>)));
		new Setting(this.contentEl).setName('过程指标').setDesc('过程指标和结果指标至少填写一个').addText((text) => text.onChange((value) => (this.processMetric = value.trim())));
		new Setting(this.contentEl).setName('结果指标').addText((text) => text.onChange((value) => (this.resultMetric = value.trim())));
      new Setting(this.contentEl).setName('优先级').addDropdown((dropdown) => dropdown
        .addOptions({ P0: 'P0', P1: 'P1', P2: 'P2', P3: 'P3', P4: 'P4' })
        .setValue(this.priority)
        .onChange((value) => (this.priority = value)));
    }
	if (this.kind === 'task') {
		new Setting(this.contentEl).setName('关联项目').setDesc('可填写多个 wikilink，用逗号分隔；留空即零散任务').addText((text) => text.onChange((value) => (this.taskProjects = value)));
		new Setting(this.contentEl).setName('预计分钟').addText((text) => text.setValue('30').onChange((value) => (this.estimateMinutes = Number(value))));
		new Setting(this.contentEl).setName('能量要求').addDropdown((dropdown) => dropdown
			.addOptions({ low: '低', medium: '中', high: '高' }).setValue(this.taskEnergy)
			.onChange((value) => (this.taskEnergy = value as NonNullable<CreateExtra['energy']>)));
		new Setting(this.contentEl).setName('工作模式').addDropdown((dropdown) => dropdown
			.addOptions({ shallow: '浅工作', deep: '深度工作', collaborative: '协作', administrative: '事务' }).setValue(this.taskWorkMode)
			.onChange((value) => (this.taskWorkMode = value as NonNullable<CreateExtra['work_mode']>)));
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
		const extra: CreateExtra = this.kind === 'goal'
			? { period: this.period, allocation_weight: this.allocationWeight, metric: this.metric ? [this.metric] : [] }
			: this.kind === 'project'
			? {
				primary_goal: this.primaryGoal, goal_alignment: this.goalAlignment, priority: this.priority,
				process_metric: this.processMetric ? [this.processMetric] : [], result_metric: this.resultMetric ? [this.resultMetric] : [],
			}
			: this.kind === 'task' ? {
				projects: this.taskProjects.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
				estimate_minutes: this.estimateMinutes, energy: this.taskEnergy, work_mode: this.taskWorkMode, growth_mode: 'neutral',
			}
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
