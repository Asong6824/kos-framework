import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  KosLiveSyncEngine,
  type KosLiveSyncPersistedState,
  type KosLiveSyncStateRepository,
  type KosSyncVaultFile,
  type KosSyncVaultPort,
} from '../src/sync/livesync-engine';
import type { KosSyncSettings } from '../src/sync/model';
import type { KosJournalStorage } from '../src/sync/upstream/r2-storage';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class MemoryVault implements KosSyncVaultPort {
  readonly files = new Map<string, { data: Uint8Array; ctime: number; mtime: number }>();

  set(path: string, content: string, mtime: number): void {
    this.files.set(path, { data: encoder.encode(content), ctime: 1, mtime });
  }

  setBytes(path: string, content: Uint8Array, mtime: number): void {
    this.files.set(path, { data: content.slice(), ctime: 1, mtime });
  }

  text(path: string): string | undefined {
    const file = this.files.get(path);
    return file ? decoder.decode(file.data) : undefined;
  }

  bytes(path: string): Uint8Array | undefined {
    return this.files.get(path)?.data.slice();
  }

  async listFiles(): Promise<KosSyncVaultFile[]> {
    return [...this.files].map(([path, file]) => ({
      path,
      ctime: file.ctime,
      mtime: file.mtime,
      size: file.data.byteLength,
    }));
  }

  async read(path: string): Promise<Uint8Array> {
    const file = this.files.get(path);
    if (!file) throw new Error(`missing ${path}`);
    return file.data.slice();
  }

  async write(path: string, data: Uint8Array, ctime: number, mtime: number): Promise<KosSyncVaultFile> {
    this.files.set(path, { data: data.slice(), ctime, mtime });
    return { path, ctime, mtime, size: data.byteLength };
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }
}

class MemoryState implements KosLiveSyncStateRepository {
  value: KosLiveSyncPersistedState = { vaultId: '', checkpoints: {}, reflection: {} };

  async load(): Promise<KosLiveSyncPersistedState> {
    return structuredClone(this.value);
  }

  async save(state: KosLiveSyncPersistedState): Promise<void> {
    this.value = structuredClone(state);
  }
}

class MemoryStorage implements KosJournalStorage {
  readonly objects = new Map<string, Uint8Array>();

  async upload(key: string, data: Uint8Array): Promise<void> {
    this.objects.set(key, data.slice());
  }

  async download(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key)?.slice() ?? null;
  }

  async listFiles(from: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key > (from ?? '')).sort();
  }

  async deleteFiles(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.objects.delete(key);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

function settings(): KosSyncSettings {
  return {
    enabled: true,
    accountId: '0123456789abcdef0123456789abcdef',
    bucket: 'kos-vault',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    vaultId: '123e4567-e89b-42d3-a456-426614174000',
    paused: false,
  };
}

describe('KosLiveSyncEngine production boundary', () => {
  it('syncs create, update and delete between two persistent IndexedDB devices', async () => {
    const storage = new MemoryStorage();
    const firstVault = new MemoryVault();
    const secondVault = new MemoryVault();
    const firstState = new MemoryState();
    const secondState = new MemoryState();
    const firstEngine = () => new KosLiveSyncEngine(
      firstVault,
      firstState,
      () => storage,
      (vaultId) => `test-first-${vaultId}`,
    );
    const secondEngine = () => new KosLiveSyncEngine(
      secondVault,
      secondState,
      () => storage,
      (vaultId) => `test-second-${vaultId}`,
    );

    firstVault.set('知识/同步.md', 'first', 1);
    firstVault.set('知识/同步二.md', 'another', 1);
    let engine = firstEngine();
    await engine.start(settings(), () => undefined);
    await engine.stop();

    engine = secondEngine();
    const pendingDownloads: number[] = [];
    await engine.start(settings(), (progress) => {
      if (progress.pendingDownloads !== undefined) pendingDownloads.push(progress.pendingDownloads);
    });
    expect(secondVault.text('知识/同步.md')).toBe('first');
    expect(secondVault.text('知识/同步二.md')).toBe('another');
    expect(pendingDownloads.some((count) => count > 0)).toBe(true);
    expect(pendingDownloads[pendingDownloads.length - 1]).toBe(0);
    secondVault.set('知识/同步.md', 'second', 2);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await engine.sync();
    await engine.stop();

    engine = firstEngine();
    await engine.start(settings(), () => undefined);
    expect(firstVault.text('知识/同步.md')).toBe('second');
    firstVault.set('知识/同步.md', 'from-first', 3);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await engine.sync();
    await engine.stop();

    secondVault.set('知识/同步.md', 'from-second', 4);
    let conflictCount = 0;
    engine = secondEngine();
    await engine.start(settings(), (progress) => {
      conflictCount = Math.max(conflictCount, progress.conflicts ?? 0);
    });
    const conflictPath = [...secondVault.files.keys()].find((path) => path.includes('.sync-conflict-'));
    expect(conflictPath).toBeDefined();
    expect(new Set([
      secondVault.text('知识/同步.md'),
      secondVault.text(conflictPath!),
    ])).toEqual(new Set(['from-first', 'from-second']));
    expect(conflictCount).toBeGreaterThan(0);
    await engine.stop();

    engine = firstEngine();
    await engine.start(settings(), () => undefined);
    firstVault.files.delete('知识/同步.md');
    await new Promise((resolve) => setTimeout(resolve, 2));
    await engine.sync();
    await engine.stop();

    engine = secondEngine();
    await engine.start(settings(), () => undefined);
    expect(secondVault.text('知识/同步.md')).toBeUndefined();
    await engine.stop();
  }, 20_000);

  it('does not count conflict-shaped files in excluded Framework backups', async () => {
    const storage = new MemoryStorage();
    const vault = new MemoryVault();
    const state = new MemoryState();
    vault.set('90_系统/framework-backups/old.sync-conflict-revision.md', 'backup', 1);
    const progress: number[] = [];
    const engine = new KosLiveSyncEngine(
      vault,
      state,
      () => storage,
      (vaultId) => `test-excluded-conflict-${vaultId}`,
    );
    await engine.start(settings(), (value) => {
      if (value.conflicts !== undefined) progress.push(value.conflicts);
    });
    expect(progress[progress.length - 1]).toBe(0);
    await engine.stop();
  }, 20_000);

  it('resets checkpoint and reflection when joining a different Vault ID', async () => {
    const storage = new MemoryStorage();
    const firstVault = new MemoryVault();
    const secondVault = new MemoryVault();
    const firstState = new MemoryState();
    const secondState = new MemoryState();
    const currentSettings = settings();
    firstVault.set('知识/换库后仍应上传.md', 'must-survive', 10);
    firstState.value = {
      vaultId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      checkpoints: {},
      reflection: {
        '知识/换库后仍应上传.md': {
          ctime: 1,
          mtime: 10,
          size: encoder.encode('must-survive').byteLength,
        },
      },
    };

    let engine = new KosLiveSyncEngine(
      firstVault,
      firstState,
      () => storage,
      (vaultId) => `test-rejoin-first-${vaultId}`,
    );
    await engine.start(currentSettings, () => undefined);
    await engine.stop();
    expect(firstState.value.vaultId).toBe(currentSettings.vaultId);

    engine = new KosLiveSyncEngine(
      secondVault,
      secondState,
      () => storage,
      (vaultId) => `test-rejoin-second-${vaultId}`,
    );
    await engine.start(currentSettings, () => undefined);
    expect(secondVault.text('知识/换库后仍应上传.md')).toBe('must-survive');
    await engine.stop();
  }, 20_000);

  it('rebuilds checkpoints when IndexedDB is empty but Vault state came from an older profile', async () => {
    const storage = new MemoryStorage();
    const sourceVault = new MemoryVault();
    const targetVault = new MemoryVault();
    const sourceState = new MemoryState();
    const targetState = new MemoryState();
    const currentSettings = settings();
    sourceVault.set('知识/原有.md', 'remote-baseline', 10);

    let source = new KosLiveSyncEngine(
      sourceVault,
      sourceState,
      () => storage,
      (vaultId) => `test-profile-old-${vaultId}`,
    );
    await source.start(currentSettings, () => undefined);
    await source.stop();

    sourceVault.set('20_处理区/.gitkeep', '', 20);
    source = new KosLiveSyncEngine(
      sourceVault,
      sourceState,
      () => storage,
      (vaultId) => `test-profile-rebuilt-${vaultId}`,
    );
    await source.start(currentSettings, () => undefined);
    await source.stop();

    const target = new KosLiveSyncEngine(
      targetVault,
      targetState,
      () => storage,
      (vaultId) => `test-profile-target-${vaultId}`,
    );
    await target.start(currentSettings, () => undefined);
    expect(targetVault.text('知识/原有.md')).toBe('remote-baseline');
    expect(targetVault.text('20_处理区/.gitkeep')).toBe('');
    await target.stop();
  }, 20_000);

  it('joins an existing remote without turning identical pre-populated files into tombstones', async () => {
    const storage = new MemoryStorage();
    const firstVault = new MemoryVault();
    const secondVault = new MemoryVault();
    const firstState = new MemoryState();
    const secondState = new MemoryState();
    const currentSettings = settings();
    firstVault.set('90_系统/文档/快速开始.md', 'same-doc', 10);
    firstVault.set('80_Skills/core/example/SKILL.md', 'same-skill', 11);
    secondVault.set('90_系统/文档/快速开始.md', 'same-doc', 20);
    secondVault.set('80_Skills/core/example/SKILL.md', 'same-skill', 21);

    const first = new KosLiveSyncEngine(
      firstVault,
      firstState,
      () => storage,
      (vaultId) => `test-prepopulated-first-${vaultId}`,
    );
    const second = new KosLiveSyncEngine(
      secondVault,
      secondState,
      () => storage,
      (vaultId) => `test-prepopulated-second-${vaultId}`,
    );
    await first.start(currentSettings, () => undefined);
    await second.start(currentSettings, () => undefined);
    firstVault.set('10_收件箱/触发第二轮.md', 'round-two', 30);
    await first.sync();
    await second.sync();

    expect(secondVault.text('90_系统/文档/快速开始.md')).toBe('same-doc');
    expect(secondVault.text('80_Skills/core/example/SKILL.md')).toBe('same-skill');
    expect(secondVault.text('10_收件箱/触发第二轮.md')).toBe('round-two');
    await first.stop();
    await second.stop();
  }, 20_000);

  it('syncs a binary attachment and models rename as create plus tombstone', async () => {
    const storage = new MemoryStorage();
    const firstVault = new MemoryVault();
    const secondVault = new MemoryVault();
    const firstState = new MemoryState();
    const secondState = new MemoryState();
    const firstEngine = new KosLiveSyncEngine(
      firstVault,
      firstState,
      () => storage,
      (vaultId) => `test-binary-first-${vaultId}`,
    );
    const secondEngine = new KosLiveSyncEngine(
      secondVault,
      secondState,
      () => storage,
      (vaultId) => `test-binary-second-${vaultId}`,
    );
    const attachment = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);

    firstVault.setBytes('附件/原始.bin', attachment, 1);
    await firstEngine.start(settings(), () => undefined);
    await secondEngine.start(settings(), () => undefined);
    expect(secondVault.bytes('附件/原始.bin')).toEqual(attachment);

    firstVault.files.delete('附件/原始.bin');
    firstVault.setBytes('附件/重命名.bin', attachment, 2);
    await firstEngine.sync();
    await secondEngine.sync();

    expect(secondVault.bytes('附件/原始.bin')).toBeUndefined();
    expect(secondVault.bytes('附件/重命名.bin')).toEqual(attachment);
    await firstEngine.stop();
    await secondEngine.stop();
  }, 20_000);

  it('silently deduplicates identical files when another populated device joins', async () => {
    const storage = new MemoryStorage();
    const firstVault = new MemoryVault();
    const secondVault = new MemoryVault();
    firstVault.set('知识/相同.md', 'same-content', 1);
    secondVault.set('知识/相同.md', 'same-content', 2);
    const first = new KosLiveSyncEngine(
      firstVault,
      new MemoryState(),
      () => storage,
      (vaultId) => `test-identical-first-${vaultId}`,
    );
    const second = new KosLiveSyncEngine(
      secondVault,
      new MemoryState(),
      () => storage,
      (vaultId) => `test-identical-second-${vaultId}`,
    );
    let conflicts = 0;

    await first.start(settings(), () => undefined);
    await second.start(settings(), (progress) => {
      conflicts = Math.max(conflicts, progress.conflicts ?? 0);
    });

    expect(secondVault.text('知识/相同.md')).toBe('same-content');
    expect([...secondVault.files.keys()].filter((path) => path.includes('.sync-conflict-'))).toEqual([]);
    expect(conflicts).toBe(0);
    await first.stop();
    await second.stop();
  }, 20_000);
});
