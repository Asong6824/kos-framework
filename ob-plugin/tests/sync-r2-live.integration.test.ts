import 'fake-indexeddb/auto';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  KosLiveSyncEngine,
  type KosLiveSyncPersistedState,
  type KosLiveSyncStateRepository,
  type KosSyncVaultFile,
  type KosSyncVaultPort,
} from '../src/sync/livesync-engine';
import type { KosSyncSettings } from '../src/sync/model';
import { KosR2Storage } from '../src/sync/upstream/r2-storage';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class LiveTestVault implements KosSyncVaultPort {
  readonly files = new Map<string, { data: Uint8Array; ctime: number; mtime: number }>();

  set(path: string, content: string, mtime: number): void {
    this.files.set(path, { data: encoder.encode(content), ctime: mtime, mtime });
  }

  text(path: string): string | undefined {
    const value = this.files.get(path);
    return value ? decoder.decode(value.data) : undefined;
  }

  async listFiles(): Promise<KosSyncVaultFile[]> {
    return [...this.files].map(([path, value]) => ({
      path,
      ctime: value.ctime,
      mtime: value.mtime,
      size: value.data.byteLength,
    }));
  }

  async read(path: string): Promise<Uint8Array> {
    const value = this.files.get(path);
    if (!value) throw new Error(`missing live-test file: ${path}`);
    return value.data.slice();
  }

  async write(path: string, data: Uint8Array, ctime: number, mtime: number): Promise<KosSyncVaultFile> {
    this.files.set(path, { data: data.slice(), ctime, mtime });
    return { path, ctime, mtime, size: data.byteLength };
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }
}

class LiveTestState implements KosLiveSyncStateRepository {
  value: KosLiveSyncPersistedState = { vaultId: '', checkpoints: {}, reflection: {} };

  async load(): Promise<KosLiveSyncPersistedState> {
    return structuredClone(this.value);
  }

  async save(state: KosLiveSyncPersistedState): Promise<void> {
    this.value = structuredClone(state);
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`真实 R2 验证缺少环境变量：${name}`);
  return value;
}

function liveSettings(): KosSyncSettings {
  return {
    enabled: true,
    accountId: requiredEnvironment('KOS_R2_ACCOUNT_ID'),
    bucket: requiredEnvironment('KOS_R2_BUCKET'),
    accessKeyId: requiredEnvironment('KOS_R2_ACCESS_KEY_ID'),
    secretAccessKey: requiredEnvironment('KOS_R2_SECRET_ACCESS_KEY'),
    vaultId: randomUUID(),
    paused: false,
  };
}

it('replicates through a private real Cloudflare R2 bucket and cleans its isolated prefix', async () => {
  const settings = liveSettings();
  const firstVault = new LiveTestVault();
  const secondVault = new LiveTestVault();
  const cleanup = new KosR2Storage(settings);
  const first = new KosLiveSyncEngine(
    firstVault,
    new LiveTestState(),
    (current) => new KosR2Storage(current),
    () => `r2-live-first-${settings.vaultId}`,
  );
  const second = new KosLiveSyncEngine(
    secondVault,
    new LiveTestState(),
    (current) => new KosR2Storage(current),
    () => `r2-live-second-${settings.vaultId}`,
  );

  try {
    firstVault.set('真实R2验证.md', `r2-live-${settings.vaultId}`, Date.now());
    await first.start(settings, () => undefined);
    await second.start(settings, () => undefined);
    expect(secondVault.text('真实R2验证.md')).toBe(`r2-live-${settings.vaultId}`);

    secondVault.set('真实R2验证.md', `updated-${settings.vaultId}`, Date.now() + 1);
    await second.sync();
    await first.sync();
    expect(firstVault.text('真实R2验证.md')).toBe(`updated-${settings.vaultId}`);

    firstVault.files.delete('真实R2验证.md');
    await first.sync();
    await second.sync();
    expect(secondVault.text('真实R2验证.md')).toBeUndefined();
  } finally {
    await first.stop();
    await second.stop();
    const keys = await cleanup.listFiles('');
    await cleanup.deleteFiles(keys);
    expect(await cleanup.listFiles('')).toEqual([]);
    cleanup.destroy();
  }
}, 60_000);
