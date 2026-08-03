import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { KosSyncEngine, KosSyncProgress, KosSyncSettings } from '../src/sync/model';
import { KosSyncService } from '../src/sync/service';

function settings(): KosSyncSettings {
  return {
    enabled: true,
    accountId: '0123456789abcdef0123456789abcdef',
    bucket: 'kos-vault',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    vaultId: randomUUID(),
    paused: false,
  };
}

function engine(overrides: Partial<KosSyncEngine> = {}): KosSyncEngine {
  return {
    start: vi.fn(async (_settings: Readonly<KosSyncSettings>, progress: (value: KosSyncProgress) => void) => {
      progress({ pendingUploads: 2, pendingDownloads: 1, message: '同步准备完成' });
    }),
    sync: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('KosSyncService', () => {
  it('stays disabled without configuration', async () => {
    const disabled = { ...settings(), enabled: false };
    const service = new KosSyncService(() => disabled, engine());
    await service.start();
    expect(service.getSnapshot().phase).toBe('disabled');
  });

  it('reports a configuration error without exposing credentials', async () => {
    const invalid = { ...settings(), secretAccessKey: '' };
    const service = new KosSyncService(() => invalid, engine());
    await service.start();
    expect(service.getSnapshot()).toMatchObject({
      phase: 'error',
      message: '缺少 R2 Secret Access Key',
    });
    expect(JSON.stringify(service.getSnapshot())).not.toContain(invalid.accessKeyId);
  });

  it('publishes progress and reaches up-to-date', async () => {
    const service = new KosSyncService(settings, engine());
    const phases: string[] = [];
    service.subscribe((snapshot) => phases.push(snapshot.phase));
    await service.start();
    expect(phases).toContain('initializing');
    expect(phases).toContain('syncing');
    expect(service.getSnapshot()).toMatchObject({
      phase: 'up-to-date',
      pendingUploads: 0,
      pendingDownloads: 0,
      message: '已同步',
    });
    expect(service.getSnapshot().lastSuccessfulSync).not.toBeNull();
    expect(service.getSnapshot().lastAttemptedSync).not.toBeNull();
    expect(service.getSnapshot().lastSyncDurationMs).toEqual(expect.any(Number));
  });

  it('maps network failures to the offline state', async () => {
    const service = new KosSyncService(settings, engine({
      sync: vi.fn(async () => {
        throw new Error('network timeout');
      }),
    }));
    await service.start();
    await service.syncNow();
    expect(service.getSnapshot()).toMatchObject({
      phase: 'offline',
      message: '同步网络连接失败；请检查网络、DNS、VPN 和设备时间后重试',
    });
  });

  it('pauses and resumes the single automatic mode', async () => {
    const adapter = engine();
    const service = new KosSyncService(settings, adapter);
    await service.start();
    await service.pause();
    expect(service.getSnapshot().phase).toBe('paused');
    await service.resume();
    expect(adapter.resume).toHaveBeenCalledOnce();
    expect(adapter.sync).toHaveBeenCalledOnce();
    expect(service.getSnapshot().phase).toBe('up-to-date');
  });

  it('initializes the engine when a Vault that started paused is resumed', async () => {
    const current = { ...settings(), paused: true };
    const adapter = engine();
    const service = new KosSyncService(() => current, adapter);
    await service.start();
    expect(adapter.start).not.toHaveBeenCalled();
    expect(service.getSnapshot().phase).toBe('paused');

    current.paused = false;
    await service.resume();
    expect(adapter.start).toHaveBeenCalledOnce();
    expect(adapter.resume).not.toHaveBeenCalled();
    expect(service.getSnapshot().phase).toBe('up-to-date');
  });

  it('reports conflicts after resuming instead of overwriting the phase with up-to-date', async () => {
    let progress: ((value: KosSyncProgress) => void) | undefined;
    const adapter = engine({
      start: vi.fn(async (_settings, next) => { progress = next; }),
      sync: vi.fn(async () => { progress?.({ conflicts: 1 }); }),
    });
    const service = new KosSyncService(settings, adapter);
    await service.start();
    await service.pause();
    await service.resume();
    expect(service.getSnapshot()).toMatchObject({ phase: 'conflict', conflicts: 1 });
  });

  it('reinitializes the engine when the first connection attempt failed', async () => {
    let attempts = 0;
    const adapter = engine({
      start: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('network timeout');
      }),
    });
    const service = new KosSyncService(settings, adapter);
    await service.start();
    expect(service.getSnapshot().phase).toBe('offline');

    await service.syncNow();
    expect(adapter.stop).toHaveBeenCalledOnce();
    expect(adapter.start).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot().phase).toBe('up-to-date');
  });

  it('runs a sync requested while initialization is still active', async () => {
    let finishStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      finishStart = resolve;
    });
    const adapter = engine({
      start: vi.fn(async () => startGate),
    });
    const service = new KosSyncService(settings, adapter);

    const starting = service.start();
    await Promise.resolve();
    const requested = service.syncNow();
    finishStart();
    await Promise.all([starting, requested]);

    expect(adapter.sync).toHaveBeenCalledOnce();
    expect(service.getSnapshot().phase).toBe('up-to-date');
  });

  it('does not leave paused state when initialization finishes afterward', async () => {
    let finishStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      finishStart = resolve;
    });
    const adapter = engine({
      start: vi.fn(async () => startGate),
    });
    const service = new KosSyncService(settings, adapter);

    const starting = service.start();
    await Promise.resolve();
    await service.pause();
    finishStart();
    await starting;

    expect(adapter.pause).toHaveBeenCalledOnce();
    expect(service.getSnapshot().phase).toBe('paused');
  });
});
