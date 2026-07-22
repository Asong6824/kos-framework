import { App, Modal, Notice, Setting } from 'obsidian';
import type { KosRecommendationFeedbackInput, KosStartDayInput, KosStartDayResult } from '../agent/protocol';

export type StartDayOperation = (input: KosStartDayInput) => Promise<KosStartDayResult>;

class StartDayModal extends Modal {
  private availableMinutes = 120;
  private energy: NonNullable<KosStartDayInput['energy']> = 'medium';
  private hardConstraints = '';
  constructor(app: App, private readonly operation: StartDayOperation, private readonly done: (result: KosStartDayResult) => void) { super(app); }
  onOpen(): void {
    this.contentEl.addClass('kos-modal');
    this.contentEl.createEl('h3', { text: '开始一天' });
    new Setting(this.contentEl).setName('可用时间（分钟）').addText((text) => {
      text.inputEl.type = 'number'; text.setValue(String(this.availableMinutes)).onChange((value) => (this.availableMinutes = Number(value)));
    });
    new Setting(this.contentEl).setName('当前精力').addDropdown((dropdown) => dropdown.addOptions({ low: '低', medium: '中', high: '高' }).setValue(this.energy).onChange((value) => (this.energy = value as typeof this.energy)));
    new Setting(this.contentEl).setName('硬约束').setDesc('截止、会议或外部承诺，每行一项').addTextArea((text) => text.onChange((value) => (this.hardConstraints = value)));
    const buttons = this.contentEl.createDiv({ cls: 'kos-modal-buttons' });
    const submit = buttons.createEl('button', { cls: 'mod-cta', text: '生成建议' });
    submit.addEventListener('click', () => {
      submit.disabled = true;
      void this.operation({ availableMinutes: this.availableMinutes, energy: this.energy, hardConstraints: this.hardConstraints.split('\n').map((item) => item.trim()).filter(Boolean) })
        .then((result) => { this.done(result); this.close(); })
        .catch((error) => { submit.disabled = false; new Notice(error instanceof Error ? error.message : String(error)); });
    });
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
  }
}

class FeedbackModal extends Modal {
  private reason = '';
  private deferUntil = '';
  private estimateMinutes: number;
  constructor(app: App, private readonly input: Omit<KosRecommendationFeedbackInput, 'reason' | 'deferUntil' | 'estimateMinutes'>, estimate: number, private readonly operation: (input: KosRecommendationFeedbackInput) => Promise<boolean>) {
    super(app); this.estimateMinutes = estimate;
  }
  onOpen(): void {
    this.contentEl.addClass('kos-modal');
    this.contentEl.createEl('h3', { text: this.input.action === 'adjusted' ? '调整建议' : this.input.action === 'deferred' ? '推迟建议' : '拒绝建议' });
    if (this.input.action === 'adjusted') new Setting(this.contentEl).setName('预计分钟').addText((text) => { text.inputEl.type = 'number'; text.setValue(String(this.estimateMinutes)).onChange((value) => (this.estimateMinutes = Number(value))); });
    if (this.input.action === 'deferred') new Setting(this.contentEl).setName('推迟到').setDesc('YYYY-MM-DD').addText((text) => text.onChange((value) => (this.deferUntil = value.trim())));
    new Setting(this.contentEl).setName('原因').addTextArea((text) => text.onChange((value) => (this.reason = value.trim())));
    const buttons = this.contentEl.createDiv({ cls: 'kos-modal-buttons' });
    const submit = buttons.createEl('button', { cls: 'mod-cta', text: '确认' });
    submit.addEventListener('click', () => void this.operation({ ...this.input, reason: this.reason, deferUntil: this.deferUntil || undefined, estimateMinutes: this.input.action === 'adjusted' ? this.estimateMinutes : undefined }).then((ok) => { if (ok) this.close(); }).catch((error) => new Notice(error instanceof Error ? error.message : String(error))));
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
  }
}

export function openStartDayModal(app: App, operation: StartDayOperation, done: (result: KosStartDayResult) => void): void {
  new StartDayModal(app, operation, done).open();
}

export function openRecommendationFeedbackModal(app: App, input: Omit<KosRecommendationFeedbackInput, 'reason' | 'deferUntil' | 'estimateMinutes'>, estimate: number, operation: (input: KosRecommendationFeedbackInput) => Promise<boolean>): void {
  new FeedbackModal(app, input, estimate, operation).open();
}
