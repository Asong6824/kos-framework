import { describe, expect, it, vi } from 'vitest';
import { KosLiveSyncJournalStorage } from '../src/sync/upstream/livesync-storage';
import type { KosJournalStorage } from '../src/sync/upstream/r2-storage';

function transport(): KosJournalStorage {
  return {
    upload: vi.fn(async () => undefined),
    download: vi.fn(async (key: string) => key === 'missing' ? null : new Uint8Array([1, 2, 3])),
    listFiles: vi.fn(async () => ['1.jsonl.gz']),
    deleteFiles: vi.fn(async () => undefined),
    isAvailable: vi.fn(async () => true),
  };
}

describe('KosLiveSyncJournalStorage', () => {
  it('adapts kos R2 transport to the pinned LiveSync storage contract', async () => {
    const r2 = transport();
    const storage = new KosLiveSyncJournalStorage(r2);

    await expect(storage.upload('1.jsonl.gz', new Uint8Array([1]), 'application/octet-stream')).resolves.toBe(true);
    await expect(storage.download('1.jsonl.gz')).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(storage.download('missing')).resolves.toBe(false);
    await expect(storage.deleteFiles(['1.jsonl.gz'])).resolves.toBe(true);
    await expect(storage.isAvailable()).resolves.toBe(true);
    await expect(storage.getUsage()).resolves.toBe(false);
  });

  it('rejects in-place configuration changes', () => {
    const storage = new KosLiveSyncJournalStorage(transport());
    expect(() => storage.applyNewConfig()).toThrow('重建 R2 storage');
  });
});
