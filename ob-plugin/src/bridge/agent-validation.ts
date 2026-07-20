import { Modal, TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { KosAgentClient } from '../agent/client';
import type { KosValidationReport } from '../agent/protocol';

class AgentValidationModal extends Modal {
  constructor(
    app: App,
    private readonly report: KosValidationReport,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('kos-validation-modal');
    contentEl.createEl('h2', { text: 'kos 系统检查' });
    contentEl.createDiv({
      cls: `kos-validation-overview ${this.report.passed ? 'is-passed' : 'is-failed'}`,
      text: this.report.passed
        ? `检查通过 · ${this.report.validatedPaths.length} 个对象文件`
        : `${this.report.errorCount} 个错误 · ${this.report.warningCount} 个警告`,
    });

    if (this.report.findings.length === 0) {
      contentEl.createDiv({ cls: 'kos-empty', text: '没有发现问题' });
      return;
    }

    const list = contentEl.createDiv({ cls: 'kos-validation-list' });
    for (const finding of this.report.findings) {
      const row = list.createDiv({ cls: `kos-validation-row kos-validation-${finding.level.toLowerCase()}` });
      row.createDiv({ cls: 'kos-validation-row-meta', text: `${finding.level} · ${finding.validator}` });
      const path = row.createEl('button', { cls: 'kos-validation-path', text: finding.path });
      path.addEventListener('click', () => void this.openPath(finding.path));
      row.createDiv({ cls: 'kos-validation-message', text: finding.message });
    }
  }

  private async openPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf('tab').openFile(file);
      this.close();
    }
  }
}

export async function runAgentValidation(app: App, client: KosAgentClient): Promise<void> {
  const report = await client.validate();
  new AgentValidationModal(app, report).open();
}
