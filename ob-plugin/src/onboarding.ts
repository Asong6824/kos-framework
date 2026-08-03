import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import { isKosOnboardingReady } from './onboarding-state';
import type { KosOnboardingSnapshot } from './onboarding-state';

export { isKosOnboardingReady } from './onboarding-state';
export type { KosOnboardingSnapshot } from './onboarding-state';

export interface KosOnboardingDeps {
  snapshot(): Promise<KosOnboardingSnapshot>;
  configureModel(): Promise<void>;
  runValidation(): Promise<void>;
  initializeObjects(): Promise<void>;
  openSyncSettings(): Promise<void>;
  setStatus(status: 'in_progress' | 'completed' | 'dismissed'): Promise<void>;
}

export class KosOnboardingModal extends Modal {
  private loading = false;

  constructor(app: App, private readonly deps: KosOnboardingDeps) {
    super(app);
  }

  onOpen(): void {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.contentEl.empty();
    this.contentEl.addClass('kos-onboarding-modal');
    this.contentEl.createEl('h2', { text: '首次使用 kos' });
    this.contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: '按顺序完成并检查结果。关闭后可以从命令面板或 kos Companion 设置重新打开。',
    });
    try {
      await this.deps.setStatus('in_progress');
      const snapshot = await this.deps.snapshot();
      const list = this.contentEl.createDiv({ cls: 'kos-onboarding-list' });
      this.step(list, true, 'kos Companion 已加载', snapshot.mobile
        ? '当前是移动端：可使用驾驶舱、Reader 和同步，不运行本地 kos-agent。'
        : '当前是桌面端：可继续配置本地 kos-agent。');

      if (snapshot.mobile) {
        this.step(
          list,
          snapshot.syncPhase === 'up-to-date',
          '加入 kos-sync Vault',
          snapshot.syncPhase === 'up-to-date' ? 'R2 已连接并完成首次同步。' : `当前同步状态：${snapshot.syncPhase}`,
          '打开同步设置',
          () => this.runAndClose(() => this.deps.openSyncSettings()),
        );
        this.step(list, snapshot.runtimePresent, '检查 Runtime 内容', snapshot.runtimePresent
          ? '快速开始和系统文档已经到达本机。'
          : '等待同步完成后应出现 90_系统/文档/00_快速开始.md。');
      } else {
        this.step(
          list,
          snapshot.modelConfigured,
          '配置并测试模型',
          snapshot.modelConfigured ? '模型已配置；连接测试在保存配置时执行。' : '选择服务预设或填写 provider，并完成“保存并测试”。',
          '打开 kos Agent',
          () => this.runAndClose(() => this.deps.configureModel()),
        );
        this.step(
          list,
          snapshot.validationPassed,
          '运行系统检查',
          snapshot.validationPassed ? '最近一次系统检查已通过。' : '确认 Vault 结构、对象和 Harness 没有错误。',
          '运行检查',
          () => this.runAndClose(() => this.deps.runValidation()),
        );
        const objectsReady = snapshot.hasGoal && snapshot.hasProject && snapshot.hasTask;
        this.step(
          list,
          objectsReady,
          '建立最小工作系统',
          objectsReady
            ? '已存在 Goal、Project 和 Task。'
            : `Goal ${snapshot.hasGoal ? '✓' : '—'} · Project ${snapshot.hasProject ? '✓' : '—'} · Task ${snapshot.hasTask ? '✓' : '—'}`,
          '填写初始化工作流',
          () => this.runAndClose(() => this.deps.initializeObjects()),
        );
        this.step(
          list,
          snapshot.syncPhase === 'up-to-date',
          '可选：配置多端同步',
          snapshot.syncPhase === 'up-to-date' ? 'R2 已连接并完成同步。' : '桌面核心流程完成后再配置 R2 和 iPad。',
          '打开同步设置',
          () => this.runAndClose(() => this.deps.openSyncSettings()),
        );
      }

      const ready = isKosOnboardingReady(snapshot);
      const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
      const complete = actions.createEl('button', { cls: 'mod-cta', text: '完成首次设置' });
      complete.disabled = !ready;
      complete.addEventListener('click', () => void this.deps.setStatus('completed').then(() => {
        new Notice('kos 首次设置已完成');
        this.close();
      }));
      actions.createEl('button', { text: '刷新状态' }).addEventListener('click', () => void this.refresh());
      actions.createEl('button', { text: '不再提示' }).addEventListener('click', () => void this.deps.setStatus('dismissed').then(() => this.close()));
    } catch (error) {
      this.contentEl.createDiv({ cls: 'kos-empty', text: error instanceof Error ? error.message : String(error) });
    } finally {
      this.loading = false;
    }
  }

  private step(
    parent: HTMLElement,
    complete: boolean,
    title: string,
    detail: string,
    actionLabel?: string,
    action?: () => void,
  ): void {
    const row = parent.createDiv({ cls: `kos-onboarding-step${complete ? ' is-complete' : ''}` });
    row.createSpan({ cls: 'kos-onboarding-check', text: complete ? '✓' : '○' });
    const copy = row.createDiv({ cls: 'kos-onboarding-copy' });
    copy.createDiv({ cls: 'kos-onboarding-title', text: title });
    copy.createDiv({ cls: 'setting-item-description', text: detail });
    if (actionLabel && action) copy.createEl('button', { text: actionLabel }).addEventListener('click', action);
  }

  private runAndClose(action: () => Promise<void>): void {
    this.close();
    void action().catch((error) => new Notice(error instanceof Error ? error.message : String(error)));
  }
}
