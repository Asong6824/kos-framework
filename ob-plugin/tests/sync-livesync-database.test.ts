import { afterEach, describe, expect, it } from 'vitest';
import PouchDB from 'pouchdb-core';
import MemoryAdapter from 'pouchdb-adapter-memory';
import {
  DEFAULT_SETTINGS,
  type EntryDoc,
} from '@lib/common/types.ts';
import { pickBucketSyncSettings, type SimpleStore } from '@lib/common/utils.ts';
import { JournalSyncCore } from '@lib/replication/journal/JournalSyncCore.ts';
import {
  CheckPointInfoDefault,
  type CheckPointInfo,
} from '@lib/replication/journal/JournalSyncTypes.ts';
import type { LiveSyncJournalReplicatorEnv } from '@lib/replication/journal/LiveSyncJournalReplicatorEnv.ts';
import type { IJournalStorage } from '@lib/replication/journal/objectstore/JournalStorageAdapter.ts';
import { KosLiveSyncDatabase } from '../upstream/livesync/kos-database';

PouchDB.plugin(MemoryAdapter);

const encoder = new TextEncoder();

describe('pinned LiveSync local database adoption', () => {
  const databases: KosLiveSyncDatabase[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.close()));
  });

  it('uses the upstream manager stack for chunked put, read and tombstone delete', async () => {
    const database = new KosLiveSyncDatabase(
      'kos-local-adoption',
      (name, options) => new PouchDB<EntryDoc>(name, { ...options, adapter: 'memory' }),
      { customChunkSize: 4, minimumChunkSize: 2 },
    );
    databases.push(database);
    await database.open();

    await database.put('知识/长笔记.md', encoder.encode('abcdefghijklmno'), 2, 1);
    const loaded = await database.get('知识/长笔记.md');
    expect(loaded).not.toBe(false);
    expect(loaded && loaded.path).toBe('知识/长笔记.md');
    expect(new TextDecoder().decode(await database.read('知识/长笔记.md') || undefined)).toBe('abcdefghijklmno');
    const docs = await database.local.localDatabase.allDocs();
    expect(docs.rows.some((row) => row.id.startsWith('h:'))).toBe(true);

    await database.delete('知识/长笔记.md');
    await expect(database.get('知识/长笔记.md')).resolves.toBe(false);
    const deleted = await database.local.getDBEntryMeta('知识/长笔记.md', {}, true);
    expect(deleted && deleted.deleted).toBe(true);
  });

  it('transfers upstream chunked file entries through the upstream Journal', async () => {
    const create = (name: string) => new KosLiveSyncDatabase(
      name,
      (dbName, options) => new PouchDB<EntryDoc>(dbName, { ...options, adapter: 'memory' }),
      { customChunkSize: 4, minimumChunkSize: 2 },
    );
    const first = create('kos-chunked-first');
    const second = create('kos-chunked-second');
    databases.push(first, second);
    await first.open();
    await second.open();

    const objects = new Map<string, Uint8Array>();
    const storage = {
      upload: async (key: string, data: Uint8Array) => {
        objects.set(key, data.slice());
        return true;
      },
      download: async (key: string) => objects.get(key)?.slice() ?? false,
      listFiles: async (from = '') => [...objects.keys()].filter((key) => key > from).sort(),
      deleteFiles: async (keys: string[]) => {
        for (const key of keys) objects.delete(key);
        return true;
      },
      isAvailable: async () => true,
      getUsage: async () => false,
      applyNewConfig: () => undefined,
    } satisfies IJournalStorage;
    const checkpoint = (): SimpleStore<CheckPointInfo> => {
      const values = new Map<string, CheckPointInfo>();
      return {
        get: async (key) => structuredClone(values.get(key) ?? CheckPointInfoDefault),
        set: async (key, value) => { values.set(key, structuredClone(value)); },
        delete: async (key) => { values.delete(key); },
        keys: async () => [...values.keys()],
      };
    };
    const env = (database: KosLiveSyncDatabase) => ({
      services: {
        database: { localDatabase: database.local },
        setting: { currentSettings: () => database.settings },
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
    }) as unknown as LiveSyncJournalReplicatorEnv;
    const journalSettings = pickBucketSyncSettings({
      ...DEFAULT_SETTINGS,
      encrypt: false,
      passphrase: '',
    });
    const firstJournal = new JournalSyncCore(journalSettings, checkpoint(), env(first), storage);
    const secondJournal = new JournalSyncCore(journalSettings, checkpoint(), env(second), storage);

    const content = '一段需要分块并完整恢复的 Markdown 内容 abcdefghijklmnopqrstuvwxyz';
    await first.put('知识/同步.md', encoder.encode(content), 2, 1);
    expect(await firstJournal.sync()).toBe(true);
    expect(await secondJournal.sync()).toBe(true);

    const received = await second.read('知识/同步.md');
    expect(received).not.toBe(false);
    expect(new TextDecoder().decode(received || undefined)).toBe(content);
    const receivedDocs = await second.local.localDatabase.allDocs();
    expect(receivedDocs.rows.some((row) => row.id.startsWith('h:'))).toBe(true);
  });
});
