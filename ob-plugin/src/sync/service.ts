import {
  DEFAULT_KOS_SYNC_SNAPSHOT,
  type KosSyncEngine,
  type KosSyncProgress,
  type KosSyncSettings,
  type KosSyncSnapshot,
} from './model';
import { validateKosSyncSettings } from './policy';
import { explainKosSyncRuntimeFailure } from './runtime-error';

type KosSyncListener = (snapshot: Readonly<KosSyncSnapshot>) => void;

export class KosSyncService {
  private snapshot: KosSyncSnapshot = { ...DEFAULT_KOS_SYNC_SNAPSHOT };
  private readonly listeners = new Set<KosSyncListener>();
  private running: Promise<void> | null = null;
  private engineStarted = false;
  private pauseRequested = false;

  constructor(
    private readonly settings: () => Readonly<KosSyncSettings>,
    private readonly engine: KosSyncEngine | null,
  ) {}

  getSnapshot(): Readonly<KosSyncSnapshot> {
    return this.snapshot;
  }

  subscribe(listener: KosSyncListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    const settings = this.settings();
    this.pauseRequested = settings.paused;
    if (!settings.enabled) {
      this.update({ ...DEFAULT_KOS_SYNC_SNAPSHOT });
      return;
    }
    const validation = validateKosSyncSettings(settings);
    if (!validation.valid) {
      this.update({ phase: 'error', message: validation.message });
      return;
    }
    if (!this.engine) {
      this.update({ phase: 'error', message: 'kos-sync 同步核心尚未连接' });
      return;
    }
    if (settings.paused) {
      this.update({ phase: 'paused', message: '已暂停' });
      return;
    }
    const startedAt = this.beginAttempt('initializing', '正在初始化同步');
    await this.run(async () => {
      await this.engine!.start(settings, (progress) => this.onProgress(progress));
      this.engineStarted = true;
      if (this.pauseRequested) {
        this.update({ phase: 'paused', message: '已暂停' });
        return;
      }
      this.finishAttempt(startedAt);
    });
  }

  async syncNow(): Promise<void> {
    if (!this.engine) {
      this.update({ phase: 'error', message: 'kos-sync 同步核心尚未连接' });
      return;
    }
    if (this.snapshot.phase === 'paused') return;
    const validation = validateKosSyncSettings(this.settings());
    if (!validation.valid) {
      this.update({ phase: 'error', message: validation.message });
      return;
    }
    if (this.running) {
      await this.running;
      if (this.getSnapshot().phase === 'paused') return;
    }
    const reconnecting = !this.engineStarted;
    const startedAt = this.beginAttempt(
      reconnecting ? 'initializing' : 'syncing',
      reconnecting ? '正在重新连接同步' : '正在同步',
    );
    await this.run(async () => {
      if (reconnecting) {
        await this.engine!.stop();
        await this.engine!.start(this.settings(), (progress) => this.onProgress(progress));
        this.engineStarted = true;
      } else {
        await this.engine!.sync();
      }
      this.finishAttempt(startedAt);
    });
  }

  async pause(): Promise<void> {
    this.pauseRequested = true;
    await this.engine?.pause();
    this.update({ phase: 'paused', message: '已暂停' });
  }

  async resume(): Promise<void> {
    if (!this.engine) {
      this.update({ phase: 'error', message: 'kos-sync 同步核心尚未连接' });
      return;
    }
    const validation = validateKosSyncSettings(this.settings());
    if (!validation.valid) {
      this.update({ phase: 'error', message: validation.message });
      return;
    }
    this.pauseRequested = false;
    const startedAt = this.beginAttempt('initializing', '正在恢复同步');
    await this.run(async () => {
      if (this.engineStarted) {
        await this.engine!.resume();
        await this.engine!.sync();
      } else {
        await this.engine!.stop();
        await this.engine!.start(this.settings(), (progress) => this.onProgress(progress));
        this.engineStarted = true;
      }
      this.finishAttempt(startedAt);
    });
  }

  async stop(): Promise<void> {
    this.pauseRequested = false;
    await this.engine?.stop();
    this.engineStarted = false;
    this.update({ ...DEFAULT_KOS_SYNC_SNAPSHOT });
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    if (this.running) return this.running;
    this.running = operation().catch((error: unknown) => {
      const failure = explainKosSyncRuntimeFailure(error);
      this.update({ phase: failure.offline ? 'offline' : 'error', message: failure.message });
    }).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private onProgress(progress: KosSyncProgress): void {
    if (this.pauseRequested) return;
    this.update({
      phase: 'syncing',
      pendingUploads: progress.pendingUploads ?? this.snapshot.pendingUploads,
      pendingDownloads: progress.pendingDownloads ?? this.snapshot.pendingDownloads,
      conflicts: progress.conflicts ?? this.snapshot.conflicts,
      message: progress.message ?? '正在同步',
    });
  }

  private beginAttempt(phase: KosSyncSnapshot['phase'], message: string): number {
    const startedAt = Date.now();
    this.update({ phase, lastAttemptedSync: new Date(startedAt).toISOString(), message });
    return startedAt;
  }

  private finishAttempt(startedAt: number): void {
    const phase = this.snapshot.conflicts > 0 ? 'conflict' : 'up-to-date';
    this.update({
      phase,
      lastSuccessfulSync: new Date().toISOString(),
      lastSyncDurationMs: Math.max(0, Date.now() - startedAt),
      pendingUploads: 0,
      pendingDownloads: 0,
      message: phase === 'conflict' ? '存在需要处理的冲突' : '已同步',
    });
  }

  private update(patch: Partial<KosSyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
