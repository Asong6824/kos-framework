import { App, Modal, Notice, Setting } from 'obsidian';
import type { KosProjectMetric, KosUpdateProjectInput } from '../agent/protocol';
import type { ProjectMetric, ProjectObject } from '../core/model';

export type UpdateProjectOperation = (input: KosUpdateProjectInput) => Promise<boolean>;

function metric(value: ProjectMetric | string, kind: 'process' | 'result', index: number): KosProjectMetric {
  if (typeof value !== 'string') return { ...value, updated: value.updated ?? '' };
  const [id, name, target, unit] = value.split('|').map((item) => item.trim());
  return { id: id || `${kind}-${index + 1}`, kind, name: name || id || '未命名指标', unit: unit || 'count', baseline: 0, target: Number(target) || 1, current: 0, updated: '', evidence: [] };
}

class ProjectEditorModal extends Modal {
  private currentStage: string;
  private nextMilestone: string;
  private due: string;
  private goalAlignment: NonNullable<ProjectObject['goal_alignment']>;
  private override: boolean;
  private overrideReason: string;
  private overrideReviewDue: string;
  private metrics: KosProjectMetric[];
  constructor(app: App, private readonly project: ProjectObject, private readonly operation: UpdateProjectOperation) {
    super(app);
    this.currentStage = project.current_stage ?? ''; this.nextMilestone = project.next_milestone ?? ''; this.due = project.due ?? '';
    this.goalAlignment = project.goal_alignment ?? 'off_goal'; this.override = project.off_goal_override; this.overrideReason = project.override_reason ?? ''; this.overrideReviewDue = project.override_review_due ?? '';
    this.metrics = [...project.process_metrics.map((item, index) => metric(item, 'process', index)), ...project.result_metrics.map((item, index) => metric(item, 'result', index))];
  }
  onOpen(): void {
    this.contentEl.addClass('kos-modal', 'kos-project-editor');
    this.contentEl.createEl('h3', { text: `编辑项目：${this.project.title ?? this.project.filePath}` });
    new Setting(this.contentEl).setName('当前阶段').addText((text) => text.setValue(this.currentStage).onChange((value) => (this.currentStage = value.trim())));
    new Setting(this.contentEl).setName('下一里程碑').addText((text) => text.setValue(this.nextMilestone).onChange((value) => (this.nextMilestone = value.trim())));
    new Setting(this.contentEl).setName('截止日').addText((text) => text.setValue(this.due).onChange((value) => (this.due = value.trim())));
    new Setting(this.contentEl).setName('目标支持度').addDropdown((dropdown) => dropdown.addOptions({ direct: '直接支持', enabling: '能力/基础支持', exploratory: '探索性', off_goal: '目标外', conflicting: '目标冲突' }).setValue(this.goalAlignment).onChange((value) => (this.goalAlignment = value as typeof this.goalAlignment)));
    new Setting(this.contentEl).setName('确认继续低支持度项目').addToggle((toggle) => toggle.setValue(this.override).onChange((value) => (this.override = value)));
    new Setting(this.contentEl).setName('继续推进理由').addText((text) => text.setValue(this.overrideReason).onChange((value) => (this.overrideReason = value.trim())));
    new Setting(this.contentEl).setName('复查日期').addText((text) => text.setValue(this.overrideReviewDue).onChange((value) => (this.overrideReviewDue = value.trim())));
    this.contentEl.createEl('h4', { text: '量化指标' });
    const metricHost = this.contentEl.createDiv({ cls: 'kos-project-metrics-editor' });
    const renderMetrics = (): void => {
      metricHost.empty();
      this.metrics.forEach((item, index) => {
        const row = metricHost.createDiv({ cls: 'kos-project-metric-row' });
        new Setting(row).setName(item.id).addDropdown((input) => input.addOptions({ process: '过程', result: '结果' }).setValue(item.kind).onChange((value) => (item.kind = value as typeof item.kind)));
        new Setting(row).setName('名称').addText((input) => input.setValue(item.name).onChange((value) => (item.name = value.trim())));
        new Setting(row).setName('单位').addText((input) => input.setValue(item.unit).onChange((value) => (item.unit = value.trim())));
        new Setting(row).setName('目标 / 当前').addText((input) => input.setValue(String(item.target)).onChange((value) => (item.target = Number(value)))).addText((input) => input.setValue(String(item.current)).onChange((value) => (item.current = Number(value))));
        row.createEl('button', { text: '删除' }).addEventListener('click', () => { this.metrics.splice(index, 1); renderMetrics(); });
      });
    };
    renderMetrics();
    this.contentEl.createEl('button', { text: '添加指标' }).addEventListener('click', () => { this.metrics.push({ id: `metric-${this.metrics.length + 1}`, kind: 'result', name: '', unit: 'count', baseline: 0, target: 1, current: 0, updated: '', evidence: [] }); renderMetrics(); });
    const buttons = this.contentEl.createDiv({ cls: 'kos-modal-buttons' });
    const save = buttons.createEl('button', { cls: 'mod-cta', text: '保存' });
    save.addEventListener('click', () => {
      save.disabled = true;
      void this.operation({ query: this.project.filePath, currentStage: this.currentStage, nextMilestone: this.nextMilestone, due: this.due, goalAlignment: this.goalAlignment, alignmentReviewed: new Date().toISOString().slice(0, 10), metrics: this.metrics, offGoalOverride: this.override, overrideReason: this.overrideReason, overrideReviewDue: this.overrideReviewDue })
        .then((ok) => { if (ok) this.close(); }).catch((error) => { save.disabled = false; new Notice(error instanceof Error ? error.message : String(error)); });
    });
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
  }
}

export function openProjectEditorModal(app: App, project: ProjectObject, operation: UpdateProjectOperation): void {
  new ProjectEditorModal(app, project, operation).open();
}
