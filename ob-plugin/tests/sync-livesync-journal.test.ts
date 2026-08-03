import { afterEach, describe, expect, it } from 'vitest';
import PouchDB from 'pouchdb-core';
import MemoryAdapter from 'pouchdb-adapter-memory';
import {
  DEFAULT_SETTINGS,
  type BucketSyncSetting,
  type DocumentID,
  type EntryDoc,
  type FilePathWithPrefix,
  type PlainEntry,
} from '@lib/common/types.ts';
import { type SimpleStore, pickBucketSyncSettings } from '@lib/common/utils.ts';
import { JournalSyncCore } from '@lib/replication/journal/JournalSyncCore.ts';
import {
  CheckPointInfoDefault,
  type CheckPointInfo,
} from '@lib/replication/journal/JournalSyncTypes.ts';
import type { LiveSyncJournalReplicatorEnv } from '@lib/replication/journal/LiveSyncJournalReplicatorEnv.ts';
import type { IJournalStorage } from '@lib/replication/journal/objectstore/JournalStorageAdapter.ts';

PouchDB.plugin(MemoryAdapter);

class MemoryJournalStorage implements IJournalStorage {
  readonly objects = new Map<string, Uint8Array>();

  async upload(key: string, data: Uint8Array): Promise<boolean> {
    this.objects.set(key, data.slice());
    return true;
  }

  async download(key: string): Promise<Uint8Array | false> {
    return this.objects.get(key)?.slice() ?? false;
  }

  async listFiles(from = ''): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key > from).sort();
  }

  async deleteFiles(keys: string[]): Promise<boolean> {
    for (const key of keys) this.objects.delete(key);
    return true;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getUsage(): Promise<false> {
    return false;
  }

  applyNewConfig(): void {}
}

class MemoryCheckpointStore implements SimpleStore<CheckPointInfo> {
  private readonly values = new Map<string, CheckPointInfo>();

  async get(key: string): Promise<CheckPointInfo> {
    const value = this.values.get(key);
    return structuredClone(value ?? CheckPointInfoDefault);
  }

  async set(key: string, value: CheckPointInfo): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.values.keys()];
  }
}

function journalEnv(database: PouchDB.Database<EntryDoc>): LiveSyncJournalReplicatorEnv {
  return {
    services: {
      database: { localDatabase: { localDatabase: database } },
      setting: {
        currentSettings: () => ({
          ...DEFAULT_SETTINGS,
          encrypt: false,
          passphrase: '',
          suspendParseReplicationResult: false,
        }),
      },
      replicator: {
        replicationStatics: {
          value: {
            sent: 0,
            arrived: 0,
            maxPullSeq: 0,
            maxPushSeq: 0,
            lastSyncPullSeq: 0,
            lastSyncPushSeq: 0,
            syncStatus: 'NOT_CONNECTED',
          },
        },
      },
      replication: { parseSynchroniseResult: async () => true },
    },
  } as unknown as LiveSyncJournalReplicatorEnv;
}

function plainEntry(id: string, body: string): PlainEntry {
  return {
    _id: id as DocumentID,
    type: 'plain',
    path: `${id}.md` as FilePathWithPrefix,
    data: body,
    children: [],
    ctime: 1,
    mtime: 1,
    size: body.length,
    eden: {},
  } as PlainEntry;
}

describe('pinned LiveSync Journal two-Vault adoption', () => {
  const databases: PouchDB.Database<EntryDoc>[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('replicates create, update and delete without encryption', async () => {
    const storage = new MemoryJournalStorage();
    const settings = pickBucketSyncSettings({
      ...DEFAULT_SETTINGS,
      encrypt: false,
      passphrase: '',
    }) as BucketSyncSetting;
    const dbA = new PouchDB<EntryDoc>('kos-journal-a', { adapter: 'memory' });
    const dbB = new PouchDB<EntryDoc>('kos-journal-b', { adapter: 'memory' });
    databases.push(dbA, dbB);
    const a = new JournalSyncCore(settings, new MemoryCheckpointStore(), journalEnv(dbA), storage);
    const b = new JournalSyncCore(settings, new MemoryCheckpointStore(), journalEnv(dbB), storage);

    await dbA.put(plainEntry('note', 'first'));
    expect(await a.sync()).toBe(true);
    expect(await b.sync()).toBe(true);
    expect((await dbB.allDocs()).rows.map((row) => row.id)).toContain('note');
    expect((await dbB.get<PlainEntry>('note')).data).toBe('first');

    await new Promise((resolve) => setTimeout(resolve, 2));
    const currentA = await dbA.get<PlainEntry>('note');
    await dbA.put({ ...currentA, data: 'second', mtime: 2, size: 6 });
    expect(await a.sync()).toBe(true);
    expect(await b.sync()).toBe(true);
    expect((await dbB.get<PlainEntry>('note')).data).toBe('second');

    await new Promise((resolve) => setTimeout(resolve, 2));
    await dbA.remove(await dbA.get('note'));
    expect(await a.sync()).toBe(true);
    expect(await b.sync()).toBe(true);
    await expect(dbB.get('note')).rejects.toMatchObject({ status: 404 });
  });
});
