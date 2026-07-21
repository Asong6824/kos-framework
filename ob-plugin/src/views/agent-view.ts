import { FuzzySuggestModal, ItemView, MarkdownView, Modal, Notice, Setting, TFile, TFolder, setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type { KosAgentClient } from '../agent/client';
import { buildAgentPrompt, mentionedVaultPaths } from '../agent/context';
import type { ObsidianPromptContext } from '../agent/context';
import { messageText, messageThinking } from '../agent/protocol';
import type {
  KosConfigureModelInput,
  KosMessage,
  KosImageContent,
  KosModelApi,
  KosModelInfo,
  KosRpcEvent,
  KosSessionStats,
  KosSessionInfo,
  KosSessionTreeNode,
  KosForkMessage,
  KosSlashCommand,
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

class CommandPickerModal extends FuzzySuggestModal<KosSlashCommand> {
  constructor(
    app: AgentView['app'],
    private readonly commands: KosSlashCommand[],
    private readonly choose: (command: KosSlashCommand) => void,
  ) {
    super(app);
    this.setPlaceholder('选择 Skill 或 prompt');
  }

  getItems(): KosSlashCommand[] {
    return this.commands;
  }

  getItemText(command: KosSlashCommand): string {
    const source = command.source === 'skill' ? 'Skill' : command.source === 'prompt' ? 'Prompt' : 'Command';
    return `/${command.name} · ${source}${command.description ? ` · ${command.description}` : ''}`;
  }

  onChooseItem(command: KosSlashCommand): void {
    this.choose(command);
  }
}

class VaultMentionModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: AgentView['app'],
    private readonly files: TFile[],
    private readonly choose: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder('提及 Vault 笔记');
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.choose(file);
  }
}

class VaultDirectoryModal extends FuzzySuggestModal<TFolder> {
  constructor(
    app: AgentView['app'],
    private readonly folders: TFolder[],
    private readonly choose: (folder: TFolder) => void,
  ) {
    super(app);
    this.setPlaceholder('附加 Vault 目录');
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path || '/';
  }

  onChooseItem(folder: TFolder): void {
    this.choose(folder);
  }
}

class ImagePickerModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: AgentView['app'],
    private readonly files: TFile[],
    private readonly choose: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder('附加 Vault 图片');
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.choose(file);
  }
}

class SessionPickerModal extends FuzzySuggestModal<KosSessionInfo> {
  constructor(
    app: AgentView['app'],
    private readonly sessions: KosSessionInfo[],
    private readonly choose: (session: KosSessionInfo) => void,
  ) {
    super(app);
    this.setPlaceholder('搜索并恢复会话');
  }

  getItems(): KosSessionInfo[] {
    return this.sessions;
  }

  getItemText(session: KosSessionInfo): string {
    const title = session.name || session.firstMessage || '未命名会话';
    return `${title} · ${new Date(session.modified).toLocaleString()} · ${session.messageCount} 条消息`;
  }

  onChooseItem(session: KosSessionInfo): void {
    this.choose(session);
  }
}

class ForkPickerModal extends FuzzySuggestModal<KosForkMessage> {
  constructor(
    app: AgentView['app'],
    private readonly messages: KosForkMessage[],
    private readonly choose: (message: KosForkMessage) => void,
  ) {
    super(app);
    this.setPlaceholder('选择分叉点');
  }

  getItems(): KosForkMessage[] {
    return this.messages;
  }

  getItemText(message: KosForkMessage): string {
    return message.text.replace(/\s+/g, ' ').slice(0, 160);
  }

  onChooseItem(message: KosForkMessage): void {
    this.choose(message);
  }
}

class TextInputModal extends Modal {
  constructor(
    app: AgentView['app'],
    private readonly title: string,
    private readonly placeholder: string,
    private readonly initialValue: string,
    private readonly submit: (value: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.addClass('kos-modal');
    this.contentEl.createEl('h3', { text: this.title });
    let value = this.initialValue;
    new Setting(this.contentEl).addText((text) => text
      .setPlaceholder(this.placeholder)
      .setValue(value)
      .onChange((next) => (value = next)));
    const row = this.contentEl.createDiv({ cls: 'kos-modal-buttons' });
    const save = row.createEl('button', { cls: 'mod-cta', text: '保存' });
    save.addEventListener('click', () => {
      save.disabled = true;
      void this.submit(value.trim()).then(() => this.close()).catch((error) => {
        save.disabled = false;
        new Notice(error instanceof Error ? error.message : String(error));
      });
    });
    row.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
  }
}

class SessionTreeModal extends Modal {
  constructor(
    app: AgentView['app'],
    private readonly tree: KosSessionTreeNode[],
    private readonly leafId: string | null,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.addClass('kos-modal', 'kos-session-tree-modal');
    this.contentEl.createEl('h3', { text: '会话分支' });
    const list = this.contentEl.createDiv({ cls: 'kos-session-tree' });
    const render = (nodes: KosSessionTreeNode[], depth: number): void => {
      for (const node of nodes) {
        const row = list.createDiv({ cls: `kos-session-tree-row${node.entry.id === this.leafId ? ' is-current' : ''}` });
        row.style.paddingInlineStart = `${depth * 14}px`;
        const icon = row.createSpan({ cls: 'kos-session-tree-icon' });
        setIcon(icon, node.children.length ? 'git-branch' : 'circle');
        row.createSpan({ cls: 'kos-session-tree-type', text: node.label || node.entry.type });
        row.createSpan({ cls: 'kos-session-tree-id', text: node.entry.id.slice(0, 8) });
        if (node.entry.id === this.leafId) row.createSpan({ cls: 'kos-session-tree-current', text: '当前' });
        render(node.children, depth + 1);
      }
    };
    render(this.tree, 0);
    if (!this.tree.length) list.createDiv({ cls: 'kos-empty', text: '当前会话还没有分支' });
  }
}

class WebSearchSetupModal extends Modal {
  private provider: 'brave' | 'exa' = 'brave';
  private apiKey = '';

  constructor(
    app: AgentView['app'],
    private readonly state: { brave: boolean; exa: boolean },
    private readonly submit: (provider: 'brave' | 'exa', apiKey: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.addClass('kos-modal');
    this.contentEl.createEl('h3', { text: '配置 Web 搜索' });
    new Setting(this.contentEl)
      .setName('Provider')
      .setDesc(`Brave ${this.state.brave ? '已配置' : '未配置'} · Exa ${this.state.exa ? '已配置' : '未配置'}`)
      .addDropdown((dropdown) => dropdown
        .addOption('brave', 'Brave Search')
        .addOption('exa', 'Exa')
        .setValue(this.provider)
        .onChange((value) => (this.provider = value as 'brave' | 'exa')));
    new Setting(this.contentEl).setName('API key').addText((text) => {
      text.inputEl.type = 'password';
      text.setPlaceholder('仅保存到 kos-agent auth.json').onChange((value) => (this.apiKey = value));
    });
    const row = this.contentEl.createDiv({ cls: 'kos-modal-buttons' });
    const save = row.createEl('button', { cls: 'mod-cta', text: '保存' });
    save.addEventListener('click', () => {
      save.disabled = true;
      void this.submit(this.provider, this.apiKey)
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
  private usageEl!: HTMLElement;
  private sendModeEl!: HTMLSelectElement;
  private attachedContext: ObsidianPromptContext | undefined;
  private idleStatus = '已连接';
  private currentModel: KosModelInfo | undefined;
  private streamingMessageEl: HTMLElement | null = null;
  private isStreaming = false;
  private thinkingLevel = 'off';
  private sessionName = '';
  private attachedImages: Array<{ path: string; image: KosImageContent }> = [];
  private titleEl!: HTMLElement;
  private commands: KosSlashCommand[] = [];
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

  async beginConversation(path?: string, prompt?: string): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    if (path) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) this.setContext({ path, content: await this.app.vault.cachedRead(file), kind: 'note' });
    }
    if (prompt) this.inputEl.value = prompt;
    this.inputEl.focus();
  }

  insertDraft(text: string): void {
    const value = text.trim();
    if (!value) return;
    const start = this.inputEl.selectionStart;
    const end = this.inputEl.selectionEnd;
    const before = this.inputEl.value.slice(0, start);
    const prefix = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    this.inputEl.setRangeText(`${prefix}${value}`, start, end, 'end');
    this.inputEl.focus();
  }

  async runConversation(path?: string, prompt?: string): Promise<void> {
    await this.beginConversation(path, prompt);
    await this.submit();
  }

  async beginInlineEdit(): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    await this.attachSelection();
    if (this.attachedContext?.kind !== 'selection') return;
    this.inputEl.value = '编辑附加选区：';
    this.inputEl.focus();
    this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
  }

  private renderShell(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('kos-agent-view');

    const header = contentEl.createDiv({ cls: 'kos-agent-header' });
    this.titleEl = header.createDiv({ cls: 'kos-agent-title', text: 'kos Agent' });
    this.statusEl = header.createDiv({ cls: 'kos-agent-status', text: '正在连接...' });
    const actions = header.createDiv({ cls: 'kos-agent-header-actions' });
    this.iconButton(actions, 'cpu', '选择模型', () => void this.selectModel());
    this.iconButton(actions, 'brain', '调整思考级别', () => void this.cycleThinking());
    this.iconButton(actions, 'settings-2', '配置模型', () => void this.configureModel());
    this.iconButton(actions, 'globe-2', '配置 Web 搜索', () => void this.configureWebSearch());
    this.iconButton(actions, 'shield-check', '运行系统检查', () => void this.runValidation());
    this.iconButton(actions, 'history', '恢复会话', () => void this.openSessionPicker());
    this.iconButton(actions, 'git-fork', '从消息分叉', () => void this.openForkPicker());
    this.iconButton(actions, 'git-branch', '查看会话树', () => void this.openSessionTree());
    this.iconButton(actions, 'copy-plus', '克隆会话', () => void this.cloneSession());
    this.iconButton(actions, 'file-pen-line', '重命名会话', () => void this.renameSession());
    this.iconButton(actions, 'minimize-2', '压缩上下文', () => void this.compactSession());
    this.iconButton(actions, 'plus', '新建会话', () => void this.newSession());
    this.iconButton(actions, 'plug', '连接 kos-agent', () => void this.connect());

    this.messagesEl = contentEl.createDiv({ cls: 'kos-agent-messages' });
    const empty = this.messagesEl.createDiv({ cls: 'kos-agent-empty' });
    empty.createDiv({ text: '开始一个会话' });

    const composer = contentEl.createDiv({ cls: 'kos-agent-composer' });
    const contextBar = composer.createDiv({ cls: 'kos-agent-context-bar' });
    this.iconButton(contextBar, 'file-text', '附加当前笔记', () => void this.attachNote());
    this.iconButton(contextBar, 'text-select', '附加当前选区', () => void this.attachSelection());
    this.iconButton(contextBar, 'at-sign', '提及 Vault 笔记', () => this.openMentionPicker());
    this.iconButton(contextBar, 'folder-tree', '附加 Vault 目录', () => this.openDirectoryPicker());
    this.iconButton(contextBar, 'image-plus', '附加图片', () => this.openImagePicker());
    this.iconButton(contextBar, 'list-filter', '选择 Skill 或 prompt', () => this.openCommandPicker());
    this.contextEl = contextBar.createDiv({ cls: 'kos-agent-context-label', text: '未附加上下文' });
    const clearContext = this.iconButton(contextBar, 'x', '清除附加上下文', () => this.clearContext());
    clearContext.addClass('kos-agent-context-clear');

    this.inputEl = composer.createEl('textarea', {
      cls: 'kos-agent-input',
      attr: { placeholder: '给 kos-agent 发消息', rows: '3' },
    });
    this.inputEl.addEventListener('keydown', (event) => {
      if (event.key === '@' && this.isMentionTrigger()) {
        event.preventDefault();
        this.openMentionPicker();
        return;
      }
      if (event.key === '/' && this.inputEl.value.trim().length === 0) {
        event.preventDefault();
        this.openCommandPicker();
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.submit();
      }
    });
    const sendRow = composer.createDiv({ cls: 'kos-agent-send-row' });
    this.sendModeEl = sendRow.createEl('select', { cls: 'dropdown kos-agent-send-mode', attr: { 'aria-label': '消息发送方式' } });
    this.sendModeEl.createEl('option', { text: '自动', value: 'auto' });
    this.sendModeEl.createEl('option', { text: '引导', value: 'steer' });
    this.sendModeEl.createEl('option', { text: '跟进', value: 'follow_up' });
    this.stopButton = this.iconButton(sendRow, 'square', '停止生成', () => void this.abort());
    this.stopButton.addClass('kos-agent-stop');
    this.stopButton.hidden = true;
    this.sendButton = this.iconButton(sendRow, 'arrow-up', '发送', () => void this.submit());
    this.sendButton.addClass('mod-cta');
    this.usageEl = composer.createDiv({ cls: 'kos-agent-usage', text: '思考 off · 0 tokens' });
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
      const [state, messages, commands, stats] = await Promise.all([
        client.getState(), client.getMessages(), client.getCommands(), client.getSessionStats(),
      ]);
      this.currentModel = state.model;
      this.thinkingLevel = state.thinkingLevel;
      this.setSessionName(state.sessionName);
      this.commands = commands;
      this.idleStatus = state.model?.id && state.model.id !== 'unknown' ? state.model.id : '未配置模型';
      this.setStatus(this.idleStatus);
      this.messagesEl.empty();
      for (const message of messages) this.renderStoredMessage(message);
      if (messages.length === 0) this.messagesEl.createDiv({ cls: 'kos-agent-empty', text: '开始一个会话' });
      this.setStreaming(state.isStreaming);
      this.renderUsage(stats);
    } catch (error) {
      this.showError(error);
    }
  }

  private async submit(): Promise<void> {
    const message = this.inputEl.value.trim();
    if (!message) return;
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    try {
      const slash = /^\/([^\s]+)/.exec(message)?.[1];
      if (slash) this.renderSkillActivation(slash);
      const mentions = await this.loadMentionContexts(message);
      const prompt = buildAgentPrompt(message, this.attachedContext, mentions);
      const images = this.attachedImages.map((item) => item.image);
      const mode = this.sendModeEl.value;
      this.inputEl.value = '';
      if (mode === 'follow_up') await this.client.followUp(prompt, images);
      else if (mode === 'steer' || (mode === 'auto' && this.isStreaming)) await this.client.steer(prompt, images);
      else {
        this.setStreaming(true);
        await this.client.prompt(prompt, undefined, images);
      }
      this.setContext(undefined);
      this.attachedImages = [];
      this.updateContextLabel();
    } catch (error) {
      this.showError(error);
      this.setStreaming(false);
    }
  }

  private renderSkillActivation(name: string): void {
    const command = this.commands.find((item) => item.name === name);
    if (!command) return;
    this.removeEmpty();
    const label = command.source === 'skill' ? 'Skill' : command.source === 'prompt' ? 'Prompt' : 'Command';
    const row = this.messagesEl.createDiv({ cls: 'kos-agent-activation' });
    row.createSpan({ cls: 'kos-agent-activation-kind', text: label });
    row.createSpan({ text: `/${name}` });
    if (command.description) row.setAttribute('title', command.description);
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
        await this.reloadSession('新会话');
      }
    } catch (error) {
      this.showError(error);
    }
  }

  private async openSessionPicker(): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    try {
      const sessions = await this.client.listSessions();
      if (!sessions.length) {
        new Notice('没有可恢复的会话');
        return;
      }
      new SessionPickerModal(this.app, sessions, (session) => void this.switchSession(session.path)).open();
    } catch (error) {
      this.showError(error);
    }
  }

  private async switchSession(path: string): Promise<void> {
    if (!this.client) return;
    try {
      const result = await this.client.switchSession(path);
      if (!result.cancelled) await this.reloadSession('已恢复会话');
    } catch (error) {
      this.showError(error);
    }
  }

  private async renameSession(): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    new TextInputModal(this.app, '重命名会话', '会话名称', this.sessionName, async (name) => {
      if (!name) throw new Error('会话名称不能为空');
      await this.client!.setSessionName(name);
      this.setSessionName(name);
    }).open();
  }

  private async compactSession(): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    try {
      await this.client.compact();
      await this.refreshUsage();
      new Notice('上下文已压缩');
    } catch (error) {
      this.showError(error);
    }
  }

  private async cloneSession(): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    try {
      const result = await this.client.cloneSession();
      if (!result.cancelled) await this.reloadSession('已克隆会话');
    } catch (error) {
      this.showError(error);
    }
  }

  private async openForkPicker(): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    try {
      const messages = await this.client.getForkMessages();
      if (!messages.length) {
        new Notice('当前会话还没有可分叉的用户消息');
        return;
      }
      new ForkPickerModal(this.app, messages, (message) => void this.forkSession(message.entryId)).open();
    } catch (error) {
      this.showError(error);
    }
  }

  private async forkSession(entryId: string): Promise<void> {
    if (!this.client) return;
    try {
      const result = await this.client.fork(entryId);
      if (!result.cancelled) {
        await this.reloadSession('已创建分叉会话');
        if (result.text) this.inputEl.value = result.text;
      }
    } catch (error) {
      this.showError(error);
    }
  }

  private async openSessionTree(): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    try {
      const { tree, leafId } = await this.client.getTree();
      new SessionTreeModal(this.app, tree, leafId).open();
    } catch (error) {
      this.showError(error);
    }
  }

  private async reloadSession(emptyText: string): Promise<void> {
    if (!this.client) return;
    const [state, messages, commands, stats] = await Promise.all([
      this.client.getState(), this.client.getMessages(), this.client.getCommands(), this.client.getSessionStats(),
    ]);
    this.currentModel = state.model;
    this.thinkingLevel = state.thinkingLevel;
    this.setSessionName(state.sessionName);
    this.commands = commands;
    this.streamingMessageEl = null;
    this.toolEls.clear();
    this.messagesEl.empty();
    for (const message of messages) this.renderStoredMessage(message);
    if (!messages.length) this.messagesEl.createDiv({ cls: 'kos-agent-empty', text: emptyText });
    this.setStreaming(state.isStreaming);
    this.renderUsage(stats);
  }

  private setSessionName(name?: string): void {
    this.sessionName = name ?? '';
    this.titleEl.setText(this.sessionName || 'kos Agent');
    this.titleEl.setAttribute('title', this.sessionName || 'kos Agent');
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

  private async configureWebSearch(): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    try {
      const state = await this.client.getWebSearchState();
      new WebSearchSetupModal(this.app, state, async (provider, apiKey) => {
        if (!apiKey.trim()) throw new Error('API key 不能为空');
        await this.client!.configureWebSearch(provider, apiKey);
        new Notice(`已配置 ${provider === 'brave' ? 'Brave Search' : 'Exa'}`);
      }).open();
    } catch (error) {
      this.showError(error);
    }
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

  private async cycleThinking(): Promise<void> {
    if (!this.client?.isRunning) await this.connect();
    if (!this.client) return;
    try {
      const level = await this.client.cycleThinkingLevel();
      if (level) {
        this.thinkingLevel = level;
        await this.refreshUsage();
      }
    } catch (error) {
      this.showError(error);
    }
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
    this.updateContextLabel();
  }

  private clearContext(): void {
    this.attachedContext = undefined;
    this.attachedImages = [];
    this.updateContextLabel();
  }

  private updateContextLabel(): void {
    const labels: string[] = [];
    if (this.attachedContext) {
      const kind = this.attachedContext.kind === 'selection' ? '选区' : this.attachedContext.kind === 'directory' ? '目录' : '笔记';
      labels.push(`${kind} · ${this.attachedContext.path}`);
    }
    if (this.attachedImages.length) labels.push(`${this.attachedImages.length} 张图片`);
    this.contextEl.setText(labels.join(' · ') || '未附加上下文');
    this.contextEl.toggleClass('is-active', labels.length > 0);
  }

  private openMentionPicker(): void {
    const files = this.app.vault.getMarkdownFiles();
    new VaultMentionModal(this.app, files, (file) => this.insertAtCursor(`@[[${file.path}]] `)).open();
  }

  private openDirectoryPicker(): void {
    const folders: TFolder[] = [];
    const visit = (folder: TFolder): void => {
      if (folder.path) folders.push(folder);
      for (const child of folder.children) if (child instanceof TFolder) visit(child);
    };
    visit(this.app.vault.getRoot());
    new VaultDirectoryModal(this.app, folders, (folder) => this.attachDirectory(folder)).open();
  }

  private attachDirectory(folder: TFolder): void {
    const files: string[] = [];
    const visit = (current: TFolder): void => {
      for (const child of current.children) {
        if (files.length >= 200) return;
        if (child instanceof TFolder) visit(child);
        else if (child instanceof TFile && child.extension === 'md') files.push(child.path);
      }
    };
    visit(folder);
    const suffix = files.length >= 200 ? '\n...（目录清单截断为 200 项）' : '';
    this.setContext({ path: folder.path, content: `${files.map((path) => `- ${path}`).join('\n')}${suffix}`, kind: 'directory' });
  }

  private openImagePicker(): void {
    const extensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
    const files = this.app.vault.getFiles().filter((file) => extensions.has(file.extension.toLowerCase()));
    if (!files.length) {
      new Notice('Vault 中没有可附加的图片');
      return;
    }
    new ImagePickerModal(this.app, files, (file) => void this.attachImage(file)).open();
  }

  private async attachImage(file: TFile): Promise<void> {
    try {
      const bytes = new Uint8Array(await this.app.vault.readBinary(file));
      const maxBytes = 10 * 1024 * 1024;
      if (bytes.byteLength > maxBytes) throw new Error('图片超过 10 MB');
      const mimeType = file.extension.toLowerCase() === 'jpg' ? 'image/jpeg' : `image/${file.extension.toLowerCase()}`;
      this.attachedImages.push({ path: file.path, image: { type: 'image', data: bytesToBase64(bytes), mimeType } });
      this.updateContextLabel();
    } catch (error) {
      this.showError(error);
    }
  }

  private openCommandPicker(): void {
    if (this.commands.length === 0) {
      new Notice('当前没有可用的 Skill 或 prompt');
      return;
    }
    new CommandPickerModal(this.app, this.commands, (command) => this.insertAtCursor(`/${command.name} `)).open();
  }

  private insertAtCursor(text: string): void {
    const start = this.inputEl.selectionStart;
    const end = this.inputEl.selectionEnd;
    this.inputEl.setRangeText(text, start, end, 'end');
    this.inputEl.focus();
  }

  private isMentionTrigger(): boolean {
    const position = this.inputEl.selectionStart;
    return position === 0 || /\s/.test(this.inputEl.value[position - 1] ?? '');
  }

  private async loadMentionContexts(message: string): Promise<ObsidianPromptContext[]> {
    const contexts: ObsidianPromptContext[] = [];
    for (const path of mentionedVaultPaths(message)) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      contexts.push({ path, content: await this.app.vault.cachedRead(file), kind: 'note' });
    }
    return contexts;
  }

  private onAgentEvent(event: KosRpcEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.setStreaming(true);
        break;
      case 'agent_settled':
        this.setStreaming(false);
        this.streamingMessageEl = null;
        void this.refreshUsage();
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
    if (output) {
      if (/Task Contract:|"kind"\s*:\s*"task_completion_run"/.test(output)) {
        card.addClass('kos-agent-task-completion');
        card.open = /Status:\s*(?:NEEDS_USER|EXHAUSTED|RETRYABLE)|"status"\s*:\s*"(?:needs_user|exhausted|retryable)"/i.test(output);
        if (summary) summary.setText(`Task Completion · ${isError ? '失败' : '完成'}`);
      }
      card.createEl('pre', { cls: 'kos-agent-tool-output', text: output });
    }
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
    this.isStreaming = streaming;
    this.sendButton.disabled = false;
    this.stopButton.hidden = !streaming;
    this.sendModeEl.value = streaming ? 'steer' : 'auto';
    if (streaming) this.setStatus('运行中');
    else this.setStatus(this.idleStatus);
  }

  private async refreshUsage(): Promise<void> {
    if (!this.client?.isRunning) return;
    try {
      this.renderUsage(await this.client.getSessionStats());
    } catch {
      // Usage is informational and must not interrupt a completed agent run.
    }
  }

  private renderUsage(stats: KosSessionStats): void {
    const context = stats.contextUsage?.percent === null || stats.contextUsage?.percent === undefined
      ? ''
      : ` · 上下文 ${stats.contextUsage.percent.toFixed(0)}%`;
    const cost = stats.cost > 0 ? ` · $${stats.cost.toFixed(4)}` : '';
    this.usageEl.setText(`思考 ${this.thinkingLevel} · ${formatTokens(stats.tokens.total)} tokens${context}${cost}`);
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

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
