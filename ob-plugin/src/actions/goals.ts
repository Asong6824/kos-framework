import { Modal, Notice, Setting, TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { GoalObject } from '../core/model';
import type { KosSetGoalWeightsInput, KosUpdateGoalInput } from '../agent/protocol';

export type SetGoalWeightsOperation = (input: KosSetGoalWeightsInput) => Promise<boolean>;
export type UpdateGoalOperation = (input: KosUpdateGoalInput) => Promise<boolean>;

function sectionValue(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^## ${escaped}\\s*$`, 'm').exec(markdown);
  if (!match) return '';
  const rest = markdown.slice((match.index ?? 0) + match[0].length);
  const next = /^## /m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest)
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
    .join('\n');
}

interface EditableGoal {
  goal: GoalObject;
  active: boolean;
  weight: number;
}

class GoalAllocationModal extends Modal {
  private readonly editable: EditableGoal[];
  private totalEl: HTMLElement | null = null;
  private submit: HTMLButtonElement | null = null;

  constructor(
    app: App,
    private readonly period: string,
    goals: GoalObject[],
    private readonly operation: SetGoalWeightsOperation,
  ) {
    super(app);
    this.editable = goals
      .filter((goal) => !['achieved', 'abandoned', 'archived'].includes(goal.status))
      .map((goal) => ({ goal, active: goal.status === 'active', weight: goal.allocation_weight }));
  }

  onOpen(): void {
    this.contentEl.addClass('kos-modal', 'kos-goal-allocation-modal');
    this.contentEl.createEl('h3', { text: `${this.period} 目标投入占比` });
    this.totalEl = this.contentEl.createDiv({ cls: 'kos-goal-allocation-total' });
    for (const item of this.editable) {
      const setting = new Setting(this.contentEl).setName(item.goal.title ?? item.goal.filePath).setDesc(item.goal.status);
      setting.addToggle((toggle) => toggle
        .setTooltip('是否作为当前周期 active Goal')
        .setValue(item.active)
        .onChange((value) => {
          item.active = value;
          this.updateTotal();
        }));
      setting.addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '100';
        text.inputEl.step = '1';
        text.setValue(String(item.weight)).onChange((value) => {
          item.weight = Number(value);
          this.updateTotal();
        });
      });
    }
    const buttons = this.contentEl.createDiv({ cls: 'kos-modal-buttons' });
    this.submit = buttons.createEl('button', { cls: 'mod-cta', text: '确认调整' });
    this.submit.addEventListener('click', () => void this.save());
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
    this.updateTotal();
  }

  private updateTotal(): void {
    const total = this.editable.filter((item) => item.active).reduce((sum, item) => sum + item.weight, 0);
    const validWeights = this.editable.every((item) => Number.isInteger(item.weight) && item.weight >= 0 && item.weight <= 100);
    const valid = validWeights && (this.editable.every((item) => !item.active) || total === 100);
    this.totalEl?.setText(`ACTIVE 合计 ${total} / 100`);
    this.totalEl?.toggleClass('is-danger', !valid);
    if (this.submit) this.submit.disabled = !valid;
  }

  private async save(): Promise<void> {
    if (!this.submit) return;
    this.submit.disabled = true;
    const changes: KosSetGoalWeightsInput['changes'] = this.editable.map((item) => {
      const targetStatus = item.active && item.goal.status !== 'active'
        ? 'active'
        : !item.active && item.goal.status === 'active' ? 'paused' : undefined;
      return targetStatus === undefined
        ? { path: item.goal.filePath, allocationWeight: item.weight }
        : { path: item.goal.filePath, allocationWeight: item.weight, targetStatus };
    });
    try {
      if (await this.operation({ period: this.period, changes, humanConfirmed: true })) this.close();
    } catch (error) {
      this.submit.disabled = false;
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export function openGoalAllocationModal(
  app: App,
  period: string,
  goals: GoalObject[],
  operation: SetGoalWeightsOperation,
): void {
  new GoalAllocationModal(app, period, goals, operation).open();
}

class GoalEditorModal extends Modal {
  private title: string;
  private health: NonNullable<KosUpdateGoalInput['health']>;
  private expectedResults = '';
  private metrics = '';
  private notDoing = '';
  private constraints = '';
  private evidence = '';
  private initialSections = { expectedResults: '', metrics: '', notDoing: '', constraints: '' };
  constructor(app: App, private readonly goal: GoalObject, private readonly operation: UpdateGoalOperation) {
    super(app); this.title = goal.title ?? ''; this.health = goal.health;
  }
  async onOpen(): Promise<void> {
    const target = this.app.vault.getAbstractFileByPath(this.goal.filePath);
    if (target instanceof TFile) {
      const markdown = await this.app.vault.read(target);
      this.expectedResults = sectionValue(markdown, '期望结果');
      this.metrics = sectionValue(markdown, '量化指标');
      this.notDoing = sectionValue(markdown, '不做什么');
      this.constraints = sectionValue(markdown, '约束与代价');
      this.initialSections = {
        expectedResults: this.expectedResults,
        metrics: this.metrics,
        notDoing: this.notDoing,
        constraints: this.constraints,
      };
    }
    this.contentEl.addClass('kos-modal');
    this.contentEl.createEl('h3', { text: `编辑目标：${this.goal.title ?? this.goal.filePath}` });
    new Setting(this.contentEl).setName('名称').addText((text) => text.setValue(this.title).onChange((value) => (this.title = value.trim())));
    new Setting(this.contentEl).setName('健康度').addDropdown((dropdown) => dropdown.addOptions({ unknown: '未判断', on_track: '正常', at_risk: '有风险', off_track: '已偏离' }).setValue(this.health).onChange((value) => (this.health = value as typeof this.health)));
    new Setting(this.contentEl).setName('期望结果').setDesc('每行一项').addTextArea((text) => text.setValue(this.expectedResults).onChange((value) => (this.expectedResults = value)));
    new Setting(this.contentEl).setName('量化指标').setDesc('每行一项；active Goal 修改结果定义会记录本次人工确认').addTextArea((text) => text.setValue(this.metrics).onChange((value) => (this.metrics = value)));
    new Setting(this.contentEl).setName('不做什么').setDesc('每行一项').addTextArea((text) => text.setValue(this.notDoing).onChange((value) => (this.notDoing = value)));
    new Setting(this.contentEl).setName('约束与代价').setDesc('每行一项').addTextArea((text) => text.setValue(this.constraints).onChange((value) => (this.constraints = value)));
    new Setting(this.contentEl).setName('追加结果证据').setDesc('每行一项，不覆盖历史').addTextArea((text) => text.onChange((value) => (this.evidence = value)));
    const lines = (value: string): string[] => value.split('\n').map((item) => item.trim()).filter(Boolean);
    const changedLines = (value: string, initial: string): string[] | undefined => value === initial ? undefined : lines(value);
    const buttons = this.contentEl.createDiv({ cls: 'kos-modal-buttons' });
    const save = buttons.createEl('button', { cls: 'mod-cta', text: '保存' });
    save.addEventListener('click', () => {
      save.disabled = true;
      void this.operation({
        path: this.goal.filePath,
        title: this.title,
        health: this.health,
        expectedResults: changedLines(this.expectedResults, this.initialSections.expectedResults),
        metrics: changedLines(this.metrics, this.initialSections.metrics),
        notDoing: changedLines(this.notDoing, this.initialSections.notDoing),
        constraints: changedLines(this.constraints, this.initialSections.constraints),
        appendEvidence: lines(this.evidence),
        humanConfirmed: this.goal.status === 'active',
      })
        .then((ok) => { if (ok) this.close(); }).catch((error) => { save.disabled = false; new Notice(error instanceof Error ? error.message : String(error)); });
    });
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
  }
}

export function openGoalEditorModal(app: App, goal: GoalObject, operation: UpdateGoalOperation): void {
  new GoalEditorModal(app, goal, operation).open();
}
