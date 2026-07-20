import { FuzzySuggestModal, ItemView, MarkdownView, Modal, Notice, Setting, setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type { KosAgentClient } from '../agent/client';
import { buildAgentPrompt } from '../agent/context';
import type { ObsidianPromptContext } from '../agent/context';
import { messageText, messageThinking } from '../agent/protocol';
import type {
  KosConfigureModelInput,
  KosMessage,
  KosModelApi,
  KosModelInfo,
  KosRpcEvent,
  KosToolResult,
  KosValidationReport,
} from '../agent/protocol';

export const AGENT_VIEW_TYPE = 'kos-agent';

export interface AgentViewDeps {
  autoStart(): boolean;
  connect(): Promise<KosAgentClient>;
}

class ModelPickerModal extends FuzzySuggestModal<KosModelInfo> {
  constructor(
    app: AgentView['app'],
    private readonly models: KosModelInfo[],
    private readonly choose: (model: KosModelInfo) => void,
  ) {
    super(app);
    this.setPlaceholder('选择模型');
  }

  getItems(): KosModelInfo[] {
    return this.models;
  }

  getItemText(model: KosModelInfo): string {
    return `${model.name ?? model.id} · ${model.provider}`;
  }

  onChooseItem(model: KosModelInfo): void {
    this.choose(model);
  }
}

class ModelSetupModal extends Modal {
  private provider: string;
  private modelId: string;
  private apiKey = '';
  private baseUrl = '';
  private api: KosModelApi = 'openai-responses';

  constructor(
    app: AgentView['app'],
    current: KosModelInfo | undefined,
    private readonly submit: (input: KosConfigureModelInput) => Promise<void>,
  ) {
    super(app);
    this.provider = current?.provider !== 'unknown' ? (current?.provider ?? 'custom') : 'custom';
    this.modelId = current?.id !== 'unknown' ? (current?.id ?? '') : '';
  }

  onOpen(): void {
    this.contentEl.addClass('kos-modal');
    this.contentEl.createEl('h3', { text: '配置模型' });
    new Setting(this.contentEl).setName('Provider').addText((text) =>
      text.setValue(this.provider).onChange((value) => (this.provider = value)),
    );
    new Setting(this.contentEl).setName('Model ID').addText((text) =>
      text.setValue(this.modelId).onChange((value) => (this.modelId = value)),
    );
    new Setting(this.contentEl).setName('API key').addText((text) => {
      text.inputEl.type = 'password';
      text.setPlaceholder('API key').onChange((value) => (this.apiKey = value));
    });
    new Setting(this.contentEl).setName('Base URL').setDesc('内置 provider 可留空').addText((text) =>
      text.setPlaceholder('https://.../v1').onChange((value) => (this.baseUrl = value)),
    );
    new Setting(this.contentEl).setName('API 协议').addDropdown((dropdown) =>
      dropdown
        .addOption('openai-responses', 'OpenAI Responses')
        .addOption('openai-completions', 'OpenAI Completions')
        .addOption('anthropic-messages', 'Anthropic Messages')
        .addOption('google-generative-ai', 'Google Generative AI')
        .setValue(this.api)
        .onChange((value) => (this.api = value as KosModelApi)),
    );

    const row = this.contentEl.createDiv({ cls: 'kos-modal-buttons' });
    const save = row.createEl('button', { cls: 'mod-cta', text: '保存并使用' });
    save.addEventListener('click', () => {
      const input: KosConfigureModelInput = {
        provider: this.provider,
        modelId: this.modelId,
        apiKey: this.apiKey,
      };
      if (this.baseUrl.trim()) {
        input.baseUrl = this.baseUrl;
        input.api = this.api;
      }
      save.disabled = true;
      void this.submit(input)
        .then(() => this.close())
        .catch((error) => {
          save.disabled = false;
          new Notice(error instanceof Error ? error.message : String(error));
        });
    });
    row.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.apiKey = '';
    this.contentEl.empty();
  }
}

export class AgentView extends ItemView {
  private client: KosAgentClient | null = null;
  private unsubscribeEvent: (() => void) | null = null;
  private unsubscribeError: (() => void) | null = null;
  private messagesEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private contextEl!: HTMLElement;
  private attachedContext: ObsidianPromptContext | undefined;
  private idleStatus = '已连接';
  private currentModel: KosModelInfo | undefined;
  private streamingMessageEl: HTMLElement | null = null;
  private readonly toolEls = new Map<string, HTMLDetailsElement>();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: AgentViewDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return AGENT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'kos Agent';
  }

  getIcon(): string {
    return 'message-square';
  }

  async onOpen(): Promise<void> {
    this.renderShell();
    if (this.deps.autoStart()) await this.connect();
    else this.setStatus('未连接');
  }

  async onClose(): Promise<void> {
    this.unsubscribeEvent?.();
    this.unsubscribeError?.();
  }

  private renderShell(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('kos-agent-view');

    const header = contentEl.createDiv({ cls: 'kos-agent-header' });
    header.createDiv({ cls: 'kos-agent-title', text: 'kos Agent' });
    this.statusEl = header.createDiv({ cls: 'kos-agent-status', text: '正在连接...' });
    const actions = header.createDiv({ cls: 'kos-agent-header-actions' });
    this.iconButton(actions, 'cpu', '选择模型', () => void this.selectModel());
    this.iconButton(actions, 'settings-2', '配置模型', () => void this.configureModel());
    this.iconButton(actions, 'shield-check', '运行系统检查', () => void this.runValidation());
    this.iconButton(actions, 'plus', '新建会话', () => void this.newSession());
    this.iconButton(actions, 'plug', '连接 kos-agent', () => void this.connect());

    this.messagesEl = contentEl.createDiv({ cls: 'kos-agent-messages' });
    const empty = this.messagesEl.createDiv({ cls: 'kos-agent-empty' });
    empty.createDiv({ text: '开始一个会话' });

    const composer = contentEl.createDiv({ cls: 'kos-agent-composer' });
    const contextBar = composer.createDiv({ cls: 'kos-agent-context-bar' });
    this.iconButton(contextBar, 'file-text', '附加当前笔记', () => void this.attachNote());
    this.iconButton(contextBar, 'text-select', '附加当前选区', () => void this.attachSelection());
    this.contextEl = contextBar.createDiv({ cls: 'kos-agent-context-label', text: '未附加上下文' });
    const clearContext = this.iconButton(contextBar, 'x', '清除附加上下文', () => this.setContext(undefined));
    clearContext.addClass('kos-agent-context-clear');

    this.inputEl = composer.createEl('textarea', {
      cls: 'kos-agent-input',
      attr: { placeholder: '给 kos-agent 发消息', rows: '3' },
    });
    this.inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.submit();
      }
    });
    const sendRow = composer.createDiv({ cls: 'kos-agent-send-row' });
    this.stopButton = this.iconButton(sendRow, 'square', '停止生成', () => void this.abort());
    this.stopButton.addClass('kos-agent-stop');
    this.stopButton.hidden = true;
    this.sendButton = this.iconButton(sendRow, 'arrow-up', '发送', () => void this.submit());
    this.sendButton.addClass('mod-cta');
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
    setIcon(button, icon);
    button.addEventListener('click', action);
    return button;
  }

  private async connect(): Promise<void> {
    if (this.client?.isRunning) return;
    this.setStatus('正在连接...');
    try {
      const client = await this.deps.connect();
      this.client = client;
      this.unsubscribeEvent?.();
      this.unsubscribeError?.();
      this.unsubscribeEvent = client.onEvent((event) => this.onAgentEvent(event));
      this.unsubscribeError = client.onError((error) => this.showError(error));
      const [state, messages] = await Promise.all([client.getState(), client.getMessages()]);
      this.currentModel = state.model;
      this.idleStatus = state.model?.id && state.model.id !== 'unknown' ? state.model.id : '未配置模型';
      this.setStatus(this.idleStatus);
      this.messagesEl.empty();
      for (const message of messages) this.renderStoredMessage(message);
      if (messages.length === 0) this.messagesEl.createDiv({ cls: 'kos-agent-empty', text: '开始一个会话' });
      this.setStreaming(state.isStreaming);
    } catch (error) {
      this.showError(error);
    }
  }

  private async submit(): Promise<void> {
    const message = this.inputEl.value.trim();
    if (!message) return;
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    this.inputEl.value = '';
    this.setStreaming(true);
    try {
      await this.client.prompt(buildAgentPrompt(message, this.attachedContext));
      this.setContext(undefined);
    } catch (error) {
      this.showError(error);
      this.setStreaming(false);
    }
  }

  private async abort(): Promise<void> {
    try {
      await this.client?.abort();
    } catch (error) {
      this.showError(error);
    }
  }

  private async newSession(): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    try {
      const result = await this.client.newSession();
      if (!result.cancelled) {
        this.messagesEl.empty();
        this.messagesEl.createDiv({ cls: 'kos-agent-empty', text: '新会话' });
        this.streamingMessageEl = null;
        this.toolEls.clear();
      }
    } catch (error) {
      this.showError(error);
    }
  }

  private async runValidation(): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    try {
      const validation = await this.client.validate();
      this.removeEmpty();
      const card = this.messagesEl.createEl('details', { cls: 'kos-agent-tool', attr: { open: '' } }) as HTMLDetailsElement;
      card.createEl('summary', { text: '系统检查' });
      this.appendValidation(card, validation);
      this.scrollToBottom();
    } catch (error) {
      this.showError(error);
    }
  }

  private async selectModel(): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    try {
      const models = await this.client.getAvailableModels();
      if (models.length === 0) {
        new ModelSetupModal(this.app, this.currentModel, (input) => this.applyModelConfiguration(input)).open();
        return;
      }
      new ModelPickerModal(this.app, models, (model) => void this.applyModel(model)).open();
    } catch (error) {
      this.showError(error);
    }
  }

  private async configureModel(): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    new ModelSetupModal(this.app, this.currentModel, (input) => this.applyModelConfiguration(input)).open();
  }

  private async applyModel(model: KosModelInfo): Promise<void> {
    if (!this.client) return;
    try {
      const selected = await this.client.setModel(model.provider, model.id);
      this.setCurrentModel(selected);
    } catch (error) {
      this.showError(error);
    }
  }

  private async applyModelConfiguration(input: KosConfigureModelInput): Promise<void> {
    if (!this.client) return;
    const model = await this.client.configureModel(input);
    this.setCurrentModel(model);
    new Notice(`已配置模型：${model.provider}/${model.id}`);
  }

  private setCurrentModel(model: KosModelInfo): void {
    this.currentModel = model;
    this.idleStatus = model.id;
    this.setStatus(this.idleStatus);
  }

  private async attachNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice('没有可附加的当前笔记');
      return;
    }
    const content = await this.app.vault.cachedRead(file);
    this.setContext({ path: file.path, content, kind: 'note' });
  }

  private async attachSelection(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
    const view = markdownLeaves.map((leaf) => leaf.view).find(
      (candidate): candidate is MarkdownView => candidate instanceof MarkdownView && candidate.file?.path === file?.path,
    );
    const selection = view?.editor.getSelection().trim();
    if (!file || !selection) {
      new Notice('当前笔记没有选区');
      return;
    }
    this.setContext({ path: file.path, content: selection, kind: 'selection' });
  }

  private setContext(context: ObsidianPromptContext | undefined): void {
    this.attachedContext = context;
    this.contextEl.setText(context ? `${context.kind === 'selection' ? '选区' : '笔记'} · ${context.path}` : '未附加上下文');
    this.contextEl.toggleClass('is-active', context !== undefined);
  }

  private onAgentEvent(event: KosRpcEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.setStreaming(true);
        break;
      case 'agent_settled':
        this.setStreaming(false);
        this.streamingMessageEl = null;
        break;
      case 'message_start':
      case 'message_update':
      case 'message_end':
        this.renderMessageEvent(event);
        break;
      case 'tool_execution_start':
        this.renderToolStart(event.toolCallId, event.toolName, event.args);
        break;
      case 'tool_execution_end':
        this.renderToolEnd(event.toolCallId, event.result, event.isError);
        break;
      case 'extension_ui_request':
        this.renderQuestion(event);
        break;
    }
  }

  private renderStoredMessage(message: KosMessage): void {
    if (message.role !== 'user' && message.role !== 'assistant') return;
    const text = messageText(message);
    if (text) this.createMessage(message.role, text, messageThinking(message));
  }

  private renderMessageEvent(event: Extract<KosRpcEvent, { type: 'message_start' | 'message_update' | 'message_end' }>): void {
    const { message } = event;
    if (message.role === 'user' && event.type === 'message_start') {
      this.removeEmpty();
      this.createMessage('user', messageText(message));
      return;
    }
    if (message.role !== 'assistant') return;
    this.removeEmpty();
    if (!this.streamingMessageEl) this.streamingMessageEl = this.createMessage('assistant', '');
    const thinking = this.streamingMessageEl.querySelector<HTMLElement>('.kos-agent-thinking');
    const body = this.streamingMessageEl.querySelector<HTMLElement>('.kos-agent-message-body');
    const thinkingText = messageThinking(message);
    if (thinking) {
      thinking.setText(thinkingText);
      thinking.hidden = !thinkingText;
    }
    body?.setText(messageText(message));
    if (event.type === 'message_end') this.streamingMessageEl = null;
    this.scrollToBottom();
  }

  private createMessage(role: string, text: string, thinking = ''): HTMLElement {
    const message = this.messagesEl.createDiv({ cls: `kos-agent-message kos-agent-message-${role}` });
    message.createDiv({ cls: 'kos-agent-message-role', text: role === 'user' ? '你' : 'kos-agent' });
    const thinkingEl = message.createEl('pre', { cls: 'kos-agent-thinking', text: thinking });
    thinkingEl.hidden = !thinking;
    message.createEl('pre', { cls: 'kos-agent-message-body', text });
    this.scrollToBottom();
    return message;
  }

  private renderToolStart(id: string, name: string, args: unknown): void {
    this.removeEmpty();
    const card = this.messagesEl.createEl('details', { cls: 'kos-agent-tool' }) as HTMLDetailsElement;
    card.createEl('summary', { text: `${name} · 运行中` });
    card.createEl('pre', { cls: 'kos-agent-tool-args', text: JSON.stringify(args, null, 2) });
    this.toolEls.set(id, card);
    this.scrollToBottom();
  }

  private renderToolEnd(id: string, result: KosToolResult, isError: boolean): void {
    const card = this.toolEls.get(id);
    if (!card) return;
    const summary = card.querySelector('summary');
    if (summary) summary.setText(`${summary.textContent?.split(' · ')[0] ?? 'tool'} · ${isError ? '失败' : '完成'}`);
    card.toggleClass('is-error', isError);
    const diff = result.details?.patch ?? result.details?.diff;
    if (diff) {
      card.open = true;
      card.createEl('pre', { cls: 'kos-agent-diff', text: diff });
    }
    const validation = result.details?.validation;
    if (validation) this.appendValidation(card, validation);
    const output = result.content?.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
    if (output) card.createEl('pre', { cls: 'kos-agent-tool-output', text: output });
    this.scrollToBottom();
  }

  private appendValidation(parent: HTMLElement, validation: KosValidationReport): void {
    if (parent instanceof HTMLDetailsElement && (!validation.passed || validation.warningCount > 0)) parent.open = true;
    const validationEl = parent.createDiv({
      cls: `kos-agent-validation ${validation.passed ? 'is-passed' : 'is-failed'}`,
    });
    validationEl.createDiv({
      cls: 'kos-agent-validation-summary',
      text: validation.passed
        ? `验证通过${validation.warningCount > 0 ? ` · ${validation.warningCount} 个警告` : ''}`
        : `验证失败 · ${validation.errorCount} 个错误`,
    });
    for (const finding of validation.findings) {
      validationEl.createDiv({
        cls: `kos-agent-validation-finding kos-agent-validation-${finding.level.toLowerCase()}`,
        text: `${finding.validator} · ${finding.path} · ${finding.message}`,
      });
    }
  }

  private renderQuestion(event: Extract<KosRpcEvent, { type: 'extension_ui_request' }>): void {
    if (event.method === 'notify') {
      if (event.message) new Notice(event.message);
      return;
    }
    if (!['select', 'confirm', 'input', 'editor'].includes(event.method)) return;
    const card = this.messagesEl.createDiv({ cls: 'kos-agent-question' });
    card.createDiv({ cls: 'kos-agent-question-title', text: event.title ?? '需要你的确认' });
    if (event.message) card.createDiv({ cls: 'kos-agent-question-message', text: event.message });
    const actions = card.createDiv({ cls: 'kos-agent-question-actions' });

    const finish = (response: { value: string } | { confirmed: boolean } | { cancelled: true }): void => {
      this.client?.respondToQuestion(event.id, response);
      card.addClass('is-answered');
      actions.empty();
      actions.createSpan({ cls: 'kos-muted', text: '已回答' });
    };

    if (event.method === 'confirm') {
      actions.createEl('button', { text: '确认', cls: 'mod-cta' }).addEventListener('click', () => finish({ confirmed: true }));
      actions.createEl('button', { text: '取消' }).addEventListener('click', () => finish({ cancelled: true }));
    } else if (event.method === 'select') {
      for (const option of event.options ?? []) {
        actions.createEl('button', { text: option }).addEventListener('click', () => finish({ value: option }));
      }
      actions.createEl('button', { text: '取消' }).addEventListener('click', () => finish({ cancelled: true }));
    } else {
      const input = card.createEl('textarea', {
        cls: 'kos-agent-question-input',
        text: event.prefill ?? '',
        attr: { placeholder: event.placeholder ?? '', rows: event.method === 'editor' ? '5' : '2' },
      });
      actions.createEl('button', { text: '回答', cls: 'mod-cta' }).addEventListener('click', () => finish({ value: input.value }));
      actions.createEl('button', { text: '取消' }).addEventListener('click', () => finish({ cancelled: true }));
    }
    this.scrollToBottom();
  }

  private setStreaming(streaming: boolean): void {
    this.sendButton.disabled = streaming;
    this.stopButton.hidden = !streaming;
    if (streaming) this.setStatus('运行中');
    else this.setStatus(this.idleStatus);
  }

  private setStatus(text: string): void {
    this.statusEl.setText(text);
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.setStreaming(false);
    this.setStatus('连接错误');
    this.removeEmpty();
    this.messagesEl.createDiv({ cls: 'kos-agent-error', text: message });
    this.scrollToBottom();
  }

  private removeEmpty(): void {
    this.messagesEl.querySelector('.kos-agent-empty')?.remove();
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }
}
