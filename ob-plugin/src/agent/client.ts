import type {
  KosAppendReaderExtractInput,
  KosAppendReaderExtractResult,
  KosCreateObjectInput,
  KosConfigureModelInput,
  KosMessage,
  KosImageContent,
  KosModelInfo,
  KosOperationResult,
  KosRpcCommand,
  KosRpcEvent,
  KosRpcState,
  KosSessionStats,
  KosSessionInfo,
  KosSessionTreeNode,
  KosForkMessage,
  KosSlashCommand,
  KosTransitionStatusInput,
  KosTransitionStatusResult,
  KosSetGoalWeightsInput,
  KosSetGoalWeightsResult,
  KosGoalHealthReview,
  KosUpdateGoalInput,
  KosUpdateProjectInput,
  KosUpdateTaskInput,
  KosTaskPoolResult,
  KosDeferTaskInput,
  KosReturnTaskToPoolInput,
  KosCompleteTaskInput,
  KosCompleteTaskResult,
  KosArchiveTaskInput,
  KosArchiveTaskResult,
  KosRecommendationFeedbackInput,
  KosReviewResult,
  KosStartDayInput,
  KosStartDayResult,
  KosTaskMigrationResult,
  KosValidationReport,
} from './protocol';

type DataListener = (chunk: string | Uint8Array) => void;
type ExitListener = (code: number | null, signal?: string | null) => void;

export interface KosAgentProcess {
  stdin: { write(data: string): boolean; end?(): void; on?(event: 'error', listener: (error: Error) => void): void };
  stdout: { on(event: 'data', listener: DataListener): void; off(event: 'data', listener: DataListener): void };
  stderr?: { on(event: 'data', listener: DataListener): void };
  once(event: 'error', listener: (error: Error) => void): void;
  once(event: 'exit', listener: ExitListener): void;
  kill(signal?: string): boolean;
  exitCode: number | null;
}

export type KosAgentProcessFactory = () => KosAgentProcess;

interface RpcResponse<T = unknown> {
  id?: string;
  type: 'response';
  command: string;
  success: boolean;
  data?: T;
  error?: string;
}

interface PendingRequest {
  resolve(response: RpcResponse): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

/** Narrow Obsidian transport adapted from Pi's RPC client and strict JSONL framing. */
export class KosAgentClient {
  private process: KosAgentProcess | null = null;
  private requestId = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventListeners = new Set<(event: KosRpcEvent) => void>();
  private readonly pendingQuestions = new Map<string, Extract<KosRpcEvent, { type: 'extension_ui_request' }>>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private decoder = new TextDecoder();
  private stderrDecoder = new TextDecoder();
  private stdoutBuffer = '';
  private stderr = '';
  private stopping = false;

  constructor(
    private readonly processFactory: KosAgentProcessFactory,
    private readonly requestTimeoutMs = 30_000,
  ) {}

  get isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  async start(): Promise<KosRpcState> {
    if (this.process) return this.getState();
    const child = this.processFactory();
    this.process = child;
    this.stderr = '';
    this.stdoutBuffer = '';
    this.decoder = new TextDecoder();
    this.stderrDecoder = new TextDecoder();

    child.stdout.on('data', this.onStdout);
    child.stderr?.on('data', (chunk) => {
      this.stderr += typeof chunk === 'string' ? chunk : this.stderrDecoder.decode(chunk, { stream: true });
    });
    child.stdin.on?.('error', (error) => this.handleExit(error));
    child.once('error', (error) => this.handleExit(error));
    child.once('exit', (code, signal) => {
      if (this.stopping) return;
      this.handleExit(new Error(`kos-agent 已退出 (code=${String(code)}, signal=${String(signal ?? '')})`));
    });

    const state = await this.getState();
    if (state.protocolVersion !== 1) {
      await this.stop();
      throw new Error(`不兼容的 kos-agent RPC 协议：${String(state.protocolVersion)}（插件需要 1）`);
    }
    return state;
  }

  async stop(): Promise<void> {
    const child = this.process;
    if (!child) return;
    this.stopping = true;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.stdin.end?.();
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 750))]);
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 250))]);
    }
    child.stdout.off('data', this.onStdout);
    this.process = null;
    this.stopping = false;
    this.rejectPending(new Error('kos-agent 连接已关闭'));
  }

  onEvent(listener: (event: KosRpcEvent) => void): () => void {
    this.eventListeners.add(listener);
    for (const question of this.pendingQuestions.values()) listener(question);
    return () => this.eventListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  getPendingQuestions(): Array<Extract<KosRpcEvent, { type: 'extension_ui_request' }>> {
    return [...this.pendingQuestions.values()];
  }

  getState(): Promise<KosRpcState> {
    return this.send<KosRpcState>({ type: 'get_state' });
  }

  async getMessages(): Promise<KosMessage[]> {
    const data = await this.send<{ messages: KosMessage[] }>({ type: 'get_messages' });
    return data.messages;
  }

  prompt(message: string, streamingBehavior?: 'steer' | 'followUp', images?: KosImageContent[]): Promise<void> {
    return this.send<void>({ type: 'prompt', message, streamingBehavior, images });
  }

  steer(message: string, images?: KosImageContent[]): Promise<void> {
    return this.send<void>({ type: 'steer', message, images });
  }

  followUp(message: string, images?: KosImageContent[]): Promise<void> {
    return this.send<void>({ type: 'follow_up', message, images });
  }

  abort(): Promise<void> {
    return this.send<void>({ type: 'abort' });
  }

  newSession(): Promise<{ cancelled: boolean }> {
    return this.send<{ cancelled: boolean }>({ type: 'new_session' });
  }

  validate(paths?: string[]): Promise<KosValidationReport> {
    return this.send<KosValidationReport>({ type: 'validate', paths });
  }

  createObject(input: KosCreateObjectInput): Promise<KosOperationResult> {
    return this.send<KosOperationResult>({ type: 'create_object', ...input });
  }

  appendReaderExtract(input: KosAppendReaderExtractInput): Promise<KosAppendReaderExtractResult> {
    return this.send<KosAppendReaderExtractResult>({ type: 'append_reader_extract', ...input });
  }

  transitionStatus(input: KosTransitionStatusInput): Promise<KosTransitionStatusResult> {
    return this.send<KosTransitionStatusResult>({ type: 'transition_status', ...input });
  }

  setGoalWeights(input: KosSetGoalWeightsInput): Promise<KosSetGoalWeightsResult> {
    return this.send<KosSetGoalWeightsResult>({ type: 'set_goal_weights', ...input });
  }

  updateGoal(input: KosUpdateGoalInput): Promise<KosOperationResult> {
    return this.send({ type: 'update_goal', ...input });
  }

  reviewGoalHealth(path: string, date?: string): Promise<KosGoalHealthReview> {
    return this.send({ type: 'review_goal_health', path, date });
  }

  updateProject(input: KosUpdateProjectInput): Promise<KosOperationResult> {
    return this.send({ type: 'update_project', ...input });
  }

  updateTask(input: KosUpdateTaskInput): Promise<KosOperationResult> {
    return this.send<KosOperationResult>({ type: 'update_task', ...input });
  }

  listTaskPool(today?: string): Promise<KosTaskPoolResult> {
    return this.send<KosTaskPoolResult>({ type: 'list_task_pool', today });
  }

  deferTask(input: KosDeferTaskInput): Promise<KosOperationResult> {
    return this.send<KosOperationResult>({ type: 'defer_task', ...input });
  }

  returnTaskToPool(input: KosReturnTaskToPoolInput): Promise<KosOperationResult> {
    return this.send<KosOperationResult>({ type: 'return_task_to_pool', ...input });
  }

  completeTask(input: KosCompleteTaskInput): Promise<KosCompleteTaskResult> {
    return this.send<KosCompleteTaskResult>({ type: 'complete_task', ...input });
  }

  archiveTask(input: KosArchiveTaskInput): Promise<KosArchiveTaskResult> {
    return this.send<KosArchiveTaskResult>({ type: 'archive_task', ...input });
  }

  migrateTaskPool(dryRun = false): Promise<KosTaskMigrationResult> {
    return this.send({ type: 'migrate_task_pool', dryRun });
  }

  startDay(input: KosStartDayInput = {}): Promise<KosStartDayResult> {
    return this.send({ type: 'start_day', ...input });
  }

  recordRecommendationFeedback(input: KosRecommendationFeedbackInput): Promise<KosOperationResult> {
    return this.send({ type: 'recommendation_feedback', ...input });
  }

  endDay(date?: string): Promise<KosReviewResult> {
    return this.send({ type: 'end_day', date });
  }

  reviewWeek(date?: string): Promise<KosReviewResult> {
    return this.send({ type: 'review_week', date });
  }

  reviewMonth(date?: string): Promise<KosReviewResult> {
    return this.send({ type: 'review_month', date });
  }

  runDailyWorkflow(workflow: 'dashboard' | 'brief' | 'diary', date?: string): Promise<KosOperationResult> {
    return this.send({ type: 'daily_workflow', workflow, date });
  }

  async getAvailableModels(): Promise<KosModelInfo[]> {
    const data = await this.send<{ models: KosModelInfo[] }>({ type: 'get_available_models' });
    return data.models;
  }

  setModel(provider: string, modelId: string): Promise<KosModelInfo> {
    return this.send<KosModelInfo>({ type: 'set_model', provider, modelId });
  }

  configureModel(input: KosConfigureModelInput): Promise<KosModelInfo> {
    return this.send<KosModelInfo>({ type: 'configure_model', ...input });
  }

  configureWebSearch(provider: 'brave' | 'exa', apiKey: string): Promise<{ provider: 'brave' | 'exa' }> {
    return this.send({ type: 'configure_web_search', provider, apiKey });
  }

  getWebSearchState(): Promise<{ brave: boolean; exa: boolean }> {
    return this.send({ type: 'get_web_search_state' });
  }

  async cycleThinkingLevel(): Promise<string | null> {
    const data = await this.send<{ level: string } | null>({ type: 'cycle_thinking_level' });
    return data?.level ?? null;
  }

  getSessionStats(): Promise<KosSessionStats> {
    return this.send<KosSessionStats>({ type: 'get_session_stats' });
  }

  async listSessions(query?: string): Promise<KosSessionInfo[]> {
    const data = await this.send<{ sessions: KosSessionInfo[] }>({ type: 'list_sessions', query });
    return data.sessions;
  }

  switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    return this.send({ type: 'switch_session', sessionPath });
  }

  setSessionName(name: string): Promise<void> {
    return this.send<void>({ type: 'set_session_name', name });
  }

  compact(customInstructions?: string): Promise<unknown> {
    return this.send({ type: 'compact', customInstructions });
  }

  cloneSession(): Promise<{ cancelled: boolean }> {
    return this.send({ type: 'clone' });
  }

  async getForkMessages(): Promise<KosForkMessage[]> {
    const data = await this.send<{ messages: KosForkMessage[] }>({ type: 'get_fork_messages' });
    return data.messages;
  }

  fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
    return this.send({ type: 'fork', entryId });
  }

  getTree(): Promise<{ tree: KosSessionTreeNode[]; leafId: string | null }> {
    return this.send({ type: 'get_tree' });
  }

  async getCommands(): Promise<KosSlashCommand[]> {
    const data = await this.send<{ commands: KosSlashCommand[] }>({ type: 'get_commands' });
    return data.commands;
  }

  respondToQuestion(id: string, response: { value: string } | { confirmed: boolean } | { cancelled: true }): void {
    this.write({ type: 'extension_ui_response', id, ...response });
    this.pendingQuestions.delete(id);
  }

  private send<T>(command: KosRpcCommand): Promise<T> {
    const id = `obsidian_${++this.requestId}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${command.type} 等待 kos-agent 响应超时${this.stderr ? `: ${this.stderr}` : ''}`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        timeout,
        resolve: (response) => {
          if (!response.success) {
            reject(new Error(response.error || `${command.type} 执行失败`));
            return;
          }
          resolve(response.data as T);
        },
        reject,
      });

      try {
        this.write({ ...command, id });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private write(value: object): void {
    if (!this.process || this.process.exitCode !== null) throw new Error('kos-agent 尚未启动');
    this.process.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private readonly onStdout = (chunk: string | Uint8Array): void => {
    this.stdoutBuffer += this.decodeChunk(chunk);
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline === -1) return;
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, '');
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.length > 0) this.handleLine(line);
    }
  };

  private decodeChunk(chunk: string | Uint8Array): string {
    return typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
  }

  private handleLine(line: string): void {
    let record: RpcResponse | KosRpcEvent;
    try {
      record = JSON.parse(line) as RpcResponse | KosRpcEvent;
    } catch {
      this.emitError(new Error(`kos-agent 返回了无效 JSONL: ${line.slice(0, 200)}`));
      return;
    }

    if (record.type === 'response' && record.id) {
      const pending = this.pending.get(record.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(record.id);
      pending.resolve(record);
      return;
    }
    const event = record as KosRpcEvent;
    if (event.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(event.method)) {
      this.pendingQuestions.set(event.id, event);
    }
    for (const listener of this.eventListeners) listener(event);
  }

  private handleExit(error: Error): void {
    if (!this.process) return;
    this.process.stdout.off('data', this.onStdout);
    this.process = null;
    this.rejectPending(error);
    this.emitError(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }
}
