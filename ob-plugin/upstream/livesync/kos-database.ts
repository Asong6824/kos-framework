import PouchDB from 'pouchdb-core';
import {
  DEFAULT_SETTINGS,
  type EntryDoc,
  type FilePathWithPrefix,
  type LoadedEntry,
  type RemoteDBSettings,
  type SavingEntry,
} from '@lib/common/types.ts';
import { determineTypeFromBlob, readContent } from '@lib/common/utils.ts';
import { LiveSyncLocalDB } from '@lib/pouchdb/LiveSyncLocalDB.ts';
import { PathServiceCompat } from '@lib/services/implements/injectable/InjectablePathService.ts';
import { ServiceContext } from '@lib/services/base/ServiceBase.ts';
import { reactiveSource } from 'octagonal-wheels/dataobject/reactive';

export type KosPouchDBFactory = (
  name: string,
  options: PouchDB.Configuration.DatabaseConfiguration,
) => PouchDB.Database<EntryDoc>;

function contentBytes(content: string | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  if (content instanceof ArrayBuffer) return new Uint8Array(content.slice(0));
  return new Uint8Array(
    content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
  );
}

/**
 * Narrow kos host for the pinned LiveSyncLocalDB and its original managers.
 *
 * This adapter deliberately supplies only the services exercised by the local
 * database. Product lifecycle, UI and remote selection stay in kos.
 */
export class KosLiveSyncDatabase {
  readonly local: LiveSyncLocalDB;
  readonly settings: RemoteDBSettings;
  readonly services: LiveSyncLocalDB['env']['services'];

  constructor(
    name: string,
    createDatabase: KosPouchDBFactory,
    settings: Partial<RemoteDBSettings> = {},
  ) {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      encrypt: false,
      passphrase: '',
      usePathObfuscation: false,
      disableWorkerForGeneratingChunks: true,
      processSmallFilesInUIThread: true,
    };
    const settingService = {
      currentSettings: () => this.settings,
    };
    const pathService = new PathServiceCompat(new ServiceContext(), {
      settingService,
    } as never);
    const finiteReplicationActivityCount = reactiveSource(0);
    const replicatorService = {
      finiteReplicationActivityCount,
      getActiveReplicator: () => undefined,
      runBoundedRemoteActivity: async <T>(task: () => T | PromiseLike<T>) => await task(),
      runFiniteReplicationActivity: async <T>(task: () => T | PromiseLike<T>) => await task(),
    };
    const databaseEvents = {
      onDatabaseInitialisation: async () => true,
      onDatabaseHasReady: async () => true,
      onUnloadDatabase: async () => true,
      onCloseDatabase: async () => true,
      onDatabaseInitialised: async () => true,
      onResetDatabase: async () => true,
    };
    const databaseService = {
      createPouchDBInstance: createDatabase,
      get localDatabase() {
        return host.local;
      },
    };
    const host = this;
    this.services = {
      API: {
        addLog: () => undefined,
        getCrypto: () => globalThis.crypto,
      },
      database: databaseService,
      databaseEvents,
      path: pathService,
      replicator: replicatorService,
      setting: settingService,
    } as unknown as LiveSyncLocalDB['env']['services'];
    this.local = new LiveSyncLocalDB(name, { services: this.services });
  }

  async open(): Promise<void> {
    if (!await this.local.initializeDatabase()) {
      throw new Error('LiveSync 本地数据库初始化失败');
    }
  }

  async close(): Promise<void> {
    await this.local.close();
  }

  async put(
    path: string,
    data: Uint8Array,
    mtime: number,
    ctime = mtime,
    mime = path.endsWith('.md') ? 'text/plain' : 'application/octet-stream',
  ): Promise<void> {
    const blob = new Blob([data.slice().buffer], { type: mime });
    const datatype = determineTypeFromBlob(blob);
    const id = await this.services.path.path2id(path as FilePathWithPrefix);
    const entry = {
      _id: id,
      path: path as FilePathWithPrefix,
      data: blob,
      ctime,
      mtime,
      size: data.byteLength,
      type: datatype,
      datatype,
      eden: {},
      children: [],
    } as SavingEntry;
    if (!await this.local.putDBEntry(entry)) throw new Error(`LiveSync 本地写入失败：${path}`);
  }

  async get(path: string): Promise<LoadedEntry | false> {
    return await this.local.getDBEntry(path as FilePathWithPrefix);
  }

  async read(path: string): Promise<Uint8Array | false> {
    const entry = await this.get(path);
    if (!entry) return false;
    const content = readContent(entry);
    return contentBytes(content);
  }

  async conflicts(path: string): Promise<string[]> {
    const entry = await this.local.getDBEntryMeta(
      path as FilePathWithPrefix,
      { conflicts: true },
      true,
    );
    return entry === false ? [] : entry._conflicts ?? [];
  }

  async readRevision(path: string, revision: string): Promise<Uint8Array | false> {
    const entry = await this.local.getDBEntry(
      path as FilePathWithPrefix,
      { rev: revision },
      false,
      true,
      true,
    );
    if (!entry) return false;
    const content = readContent(entry);
    return contentBytes(content);
  }

  async resolveRevision(path: string, revision: string): Promise<void> {
    const id = await this.services.path.path2id(path as FilePathWithPrefix);
    if (!await this.local.removeRevision(id, revision)) {
      throw new Error(`LiveSync 冲突版本清理失败：${path}@${revision}`);
    }
  }

  async delete(path: string): Promise<void> {
    if (!await this.local.deleteDBEntry(path as FilePathWithPrefix)) {
      throw new Error(`LiveSync 本地删除失败：${path}`);
    }
  }
}
