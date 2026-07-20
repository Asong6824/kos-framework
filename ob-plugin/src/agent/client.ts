import type {
  KosCreateObjectInput,
  KosConfigureModelInput,
  KosMessage,
  KosModelInfo,
  KosOperationResult,
  KosRpcCommand,
  KosRpcEvent,
  KosRpcState,
  KosTransitionStatusInput,
  KosTransitionStatusResult,
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

    return this.getState();
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
    return () => this.eventListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  getState(): Promise<KosRpcState> {
    return this.send<KosRpcState>({ type: 'get_state' });
  }

  async getMessages(): Promise<KosMessage[]> {
    const data = await this.send<{ messages: KosMessage[] }>({ type: 'get_messages' });
    return data.messages;
  }

  prompt(message: string, streamingBehavior?: 'steer' | 'followUp'): Promise<void> {
    return this.send<void>({ type: 'prompt', message, streamingBehavior });
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

  transitionStatus(input: KosTransitionStatusInput): Promise<KosTransitionStatusResult> {
    return this.send<KosTransitionStatusResult>({ type: 'transition_status', ...input });
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

  respondToQuestion(id: string, response: { value: string } | { confirmed: boolean } | { cancelled: true }): void {
    this.write({ type: 'extension_ui_response', id, ...response });
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
    for (const listener of this.eventListeners) listener(record as KosRpcEvent);
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
