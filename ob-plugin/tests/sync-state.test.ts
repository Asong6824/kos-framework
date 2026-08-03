import { describe, expect, it } from 'vitest';
import type { KosLiveSyncPersistedState } from '../src/sync/livesync-engine';
import {
  KosFileSyncStateRepository,
  parseKosLiveSyncState,
  serializeKosLiveSyncState,
} from '../src/sync/state';

describe('kos-sync checkpoint persistence', () => {
  it('round-trips checkpoint Sets and reflection metadata', () => {
    const state: KosLiveSyncPersistedState = {
      vaultId: '123e4567-e89b-42d3-a456-426614174000',
      checkpoints: {
        journal: {
          lastLocalSeq: 42,
          journalEpoch: 'epoch',
          knownIDs: new Set(['known']),
          sentIDs: new Set(['sent']),
          receivedFiles: new Set(['received']),
          sentFiles: new Set(['uploaded']),
        },
      },
      reflection: {
        '知识/同步.md': { ctime: 1, mtime: 2, size: 3 },
      },
    };

    expect(parseKosLiveSyncState(serializeKosLiveSyncState(state))).toEqual(state);
  });

  it('rejects truncated checkpoints and invalid reflection metadata', () => {
    expect(parseKosLiveSyncState('{')).toBeNull();
    expect(parseKosLiveSyncState(JSON.stringify({
      version: 1,
      checkpoints: {},
      reflection: { '知识/同步.md': { ctime: 1, mtime: 'bad', size: 3 } },
    }))).toBeNull();
  });

  it('quarantines a corrupt checkpoint before returning a clean rebuild state', async () => {
    const files = new Map([['sync-state.json', '{truncated']]);
    const repository = new KosFileSyncStateRepository({
      exists: async (path) => files.has(path),
      read: async (path) => files.get(path) ?? '',
      write: async (path, data) => {
        files.set(path, data);
      },
      rename: async (path, newPath) => {
        const data = files.get(path);
        if (data === undefined) throw new Error('missing');
        files.delete(path);
        files.set(newPath, data);
      },
    }, 'sync-state.json', () => 123);

    await expect(repository.load()).resolves.toEqual({ vaultId: '', checkpoints: {}, reflection: {} });
    expect(files.has('sync-state.json')).toBe(false);
    expect(files.get('sync-state.json.corrupt-123')).toBe('{truncated');
  });

  it('stops without overwriting when a corrupt checkpoint cannot be quarantined', async () => {
    let writes = 0;
    const repository = new KosFileSyncStateRepository({
      exists: async () => true,
      read: async () => '{truncated',
      write: async () => {
        writes += 1;
      },
      rename: async () => {
        throw new Error('read only');
      },
    }, 'sync-state.json');

    await expect(repository.load()).rejects.toThrow('同步已停止，原文件未覆盖');
    expect(writes).toBe(0);
  });
});
