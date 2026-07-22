import { Modal, Notice, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type { KosCompleteTaskInput, KosUpdateTaskInput } from '../agent/protocol';
import type { ProjectObject, TaskObject } from '../core/model';

export interface TaskOperations {
  update(input: KosUpdateTaskInput): Promise<boolean>;
  defer(path: string, deferUntil: string, reason?: string): Promise<boolean>;
  returnToPool(path: string, reason?: string): Promise<boolean>;
  complete(input: KosCompleteTaskInput): Promise<boolean>;
  archive(path: string): Promise<boolean>;
  block(path: string, reason: string, unblockCondition: string): Promise<boolean>;
}

function dateAfter(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

abstract class TaskModal extends Modal {
  protected fail(error: unknown): void {
    new Notice(error instanceof Error ? error.message : String(error));
  }
  onClose(): void { this.contentEl.empty(); }
}

class EditTaskModal extends TaskModal {
  private title: string;
  private selectedProjects: Set<string>;
  private priority: string;
  private due: string;
  private estimate: number;
  private energy: NonNullable<KosUpdateTaskInput['energy']>;
  private workMode: NonNullable<KosUpdateTaskInput['workMode']>;

  constructor(app: App, private readonly task: TaskObject, projects: ProjectObject[], private readonly operations: TaskOperations) {
    super(app);
    this.title = task.title ?? '';
    this.selectedProjects = new Set(task.projects);
    this.priority = task.priority ?? 'P2';
    this.due = task.due ?? '';
    this.estimate = task.estimate_minutes;
    this.energy = task.energy;
    this.workMode = task.work_mode;
    this.projects = projects;
  }
  private readonly projects: ProjectObject[];

  onOpen(): void {
    this.contentEl.addClass('kos-modal');
    this.contentEl.createEl('h3', { text: '编辑任务' });
    new Setting(this.contentEl).setName('标题').addText((text) => text.setValue(this.title).onChange((value) => (this.title = value)));
    const relations = this.contentEl.createDiv({ cls: 'kos-task-project-picker' });
    relations.createDiv({ cls: 'setting-item-name', text: '关联项目' });
    if (!this.projects.length) relations.createDiv({ cls: 'kos-muted', text: '暂无可关联项目，任务将作为零散任务。' });
    for (const project of this.projects) {
      const ref = `[[${project.filePath.replace(/\.md$/, '')}]]`;
      new Setting(relations).setName(project.title ?? project.filePath).addToggle((toggle) => toggle
        .setValue(this.selectedProjects.has(ref))
        .onChange((value) => value ? this.selectedProjects.add(ref) : this.selectedProjects.delete(ref)));
    }
    new Setting(this.contentEl).setName('优先级').addDropdown((dropdown) => dropdown
      .addOptions({ P0: 'P0', P1: 'P1', P2: 'P2', P3: 'P3', P4: 'P4' }).setValue(this.priority)
      .onChange((value) => (this.priority = value)));
    new Setting(this.contentEl).setName('截止日').addText((text) => text.setPlaceholder('YYYY-MM-DD').setValue(this.due).onChange((value) => (this.due = value.trim())));
    new Setting(this.contentEl).setName('预计分钟').addText((text) => text.setValue(String(this.estimate)).onChange((value) => (this.estimate = Number(value))));
    new Setting(this.contentEl).setName('能量要求').addDropdown((dropdown) => dropdown
      .addOptions({ low: '低', medium: '中', high: '高' }).setValue(this.energy)
      .onChange((value) => (this.energy = value as typeof this.energy)));
    new Setting(this.contentEl).setName('工作模式').addDropdown((dropdown) => dropdown
      .addOptions({ shallow: '浅工作', deep: '深度工作', collaborative: '协作', administrative: '事务' }).setValue(this.workMode)
      .onChange((value) => (this.workMode = value as typeof this.workMode)));
    const buttons = this.contentEl.createDiv({ cls: 'kos-modal-buttons' });
    buttons.createEl('button', { cls: 'mod-cta', text: '保存' }).addEventListener('click', () => void this.operations.update({
      path: this.task.filePath, title: this.title, projects: [...this.selectedProjects], priority: this.priority,
      due: this.due, estimateMinutes: this.estimate, energy: this.energy, workMode: this.workMode,
    }).then((ok) => { if (ok) this.close(); }).catch((error) => this.fail(error)));
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
  }
}

class DeferTaskModal extends TaskModal {
  private deferUntil = dateAfter(1);
  private reason = '';
  constructor(app: App, private readonly task: TaskObject, private readonly operations: TaskOperations) { super(app); }
  onOpen(): void {
    this.contentEl.addClass('kos-modal');
    this.contentEl.createEl('h3', { text: `推迟：${this.task.title ?? this.task.filePath}` });
    new Setting(this.contentEl).setName('推迟到').addDropdown((dropdown) => dropdown
      .addOptions({ [dateAfter(1)]: '明天', [dateAfter(7)]: '一周后', [dateAfter(14)]: '两周后' })
      .setValue(this.deferUntil).onChange((value) => (this.deferUntil = value)));
    new Setting(this.contentEl).setName('指定日期').addText((text) => text.setPlaceholder('YYYY-MM-DD').onChange((value) => { if (value.trim()) this.deferUntil = value.trim(); }));
    new Setting(this.contentEl).setName('原因').addTextArea((text) => text.onChange((value) => (this.reason = value.trim())));
    const buttons = this.contentEl.createDiv({ cls: 'kos-modal-buttons' });
    buttons.createEl('button', { cls: 'mod-cta', text: '确认推迟' }).addEventListener('click', () => void this.operations.defer(this.task.filePath, this.deferUntil, this.reason)
      .then((ok) => { if (ok) this.close(); }).catch((error) => this.fail(error)));
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
  }
}

class BlockTaskModal extends TaskModal {
  private reason = '';
  private condition = '';
  constructor(app: App, private readonly task: TaskObject, private readonly operations: TaskOperations) { super(app); }
  onOpen(): void {
    this.contentEl.addClass('kos-modal');
    this.contentEl.createEl('h3', { text: `记录阻塞：${this.task.title ?? this.task.filePath}` });
    new Setting(this.contentEl).setName('阻塞原因').addTextArea((text) => text.onChange((value) => (this.reason = value.trim())));
    new Setting(this.contentEl).setName('解除条件').addTextArea((text) => text.onChange((value) => (this.condition = value.trim())));
    const buttons = this.contentEl.createDiv({ cls: 'kos-modal-buttons' });
    buttons.createEl('button', { cls: 'mod-cta', text: '设为阻塞' }).addEventListener('click', () => void this.operations.block(this.task.filePath, this.reason, this.condition)
      .then((ok) => { if (ok) this.close(); }).catch((error) => this.fail(error)));
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
  }
}

class CompleteTaskModal extends TaskModal {
  private result = '';
  private outputs = '';
  private readonly contributions: KosCompleteTaskInput['contributions'];
  constructor(app: App, private readonly task: TaskObject, private readonly operations: TaskOperations) {
    super(app);
    this.contributions = task.projects.map((project) => ({ project, level: 'supporting', evidence: '' }));
  }
  onOpen(): void {
    this.contentEl.addClass('kos-modal');
    this.contentEl.createEl('h3', { text: `完成：${this.task.title ?? this.task.filePath}` });
    new Setting(this.contentEl).setName('实际结果').addTextArea((text) => text.onChange((value) => (this.result = value.trim())));
    new Setting(this.contentEl).setName('产物链接').setDesc('多个链接用逗号分隔').addText((text) => text.onChange((value) => (this.outputs = value)));
    if (!this.contributions.length) this.contentEl.createDiv({ cls: 'kos-muted', text: '零散任务，无需 Project 贡献判断。' });
    for (const contribution of this.contributions) {
      const row = new Setting(this.contentEl).setName(contribution.project);
      row.addDropdown((dropdown) => dropdown.addOptions({ strong: '强贡献', supporting: '支持性', incidental: '仅相关' })
        .setValue(contribution.level).onChange((value) => (contribution.level = value as typeof contribution.level)));
      row.addText((text) => text.setPlaceholder('贡献证据').onChange((value) => (contribution.evidence = value.trim())));
    }
    const buttons = this.contentEl.createDiv({ cls: 'kos-modal-buttons' });
    buttons.createEl('button', { cls: 'mod-cta', text: '确认完成' }).addEventListener('click', () => void this.operations.complete({
      path: this.task.filePath, result: this.result,
      outputs: this.outputs.split(/[,，]/).map((item) => item.trim()).filter(Boolean), contributions: this.contributions,
    }).then((ok) => { if (ok) this.close(); }).catch((error) => this.fail(error)));
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
  }
}

export function openEditTaskModal(app: App, task: TaskObject, projects: ProjectObject[], operations: TaskOperations): void {
  new EditTaskModal(app, task, projects, operations).open();
}
export function openDeferTaskModal(app: App, task: TaskObject, operations: TaskOperations): void {
  new DeferTaskModal(app, task, operations).open();
}
export function openBlockTaskModal(app: App, task: TaskObject, operations: TaskOperations): void {
  new BlockTaskModal(app, task, operations).open();
}
export function openCompleteTaskModal(app: App, task: TaskObject, operations: TaskOperations): void {
  new CompleteTaskModal(app, task, operations).open();
}
