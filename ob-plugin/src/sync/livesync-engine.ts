import type {
  KosSyncEngine,
  KosSyncProgress,
  KosSyncSettings,
} from './model';
import { isKosSyncPathIncluded, kosSyncBucketPrefix, kosSyncEndpoint } from './policy';
import {
  CheckPointInfoDefault,
  DEFAULT_SETTINGS,
  JournalSyncCore,
  KosLiveSyncDatabase,
  PouchDB,
  pickBucketSyncSettings,
  type LiveSyncCheckpoint,
  type LiveSyncLoadedEntry,
  type LiveSyncSimpleStore,
} from './upstream/livesync-runtime.js';
import { KosLiveSyncJournalStorage } from './upstream/livesync-storage';
import type { KosJournalStorage } from './upstream/r2-storage';

export interface KosSyncVaultFile {
  path: string;
  ctime: number;
  mtime: number;
  size: number;
}

export interface KosSyncVaultPort {
  listFiles(): Promise<KosSyncVaultFile[]>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array, ctime: number, mtime: number): Promise<KosSyncVaultFile>;
  delete(path: string): Promise<void>;
}

interface ReflectionEntry {
  ctime: number;
  mtime: number;
  size: number;
}

export interface KosLiveSyncPersistedState {
  vaultId: string;
  checkpoints: Record<string, LiveSyncCheckpoint>;
  reflection: Record<string, ReflectionEntry>;
}

export interface KosLiveSyncStateRepository {
  load(): Promise<KosLiveSyncPersistedState>;
  save(state: KosLiveSyncPersistedState): Promise<void>;
}

function cloneCheckpoint(value: LiveSyncCheckpoint): LiveSyncCheckpoint {
  return {
    ...value,
    knownIDs: new Set(value.knownIDs),
    sentIDs: new Set(value.sentIDs),
    receivedFiles: new Set(value.receivedFiles),
    sentFiles: new Set(value.sentFiles),
  };
}

function emptyCheckpoint(): LiveSyncCheckpoint {
  return cloneCheckpoint(CheckPointInfoDefault);
}

function mimeForPath(path: string): string {
  return /\.(?:md|txt|json|jsonl|canvas|css|js|ts|tsx|jsx|html|xml|svg|csv|yaml|yml)$/i.test(path)
    ? 'text/plain'
    : 'application/octet-stream';
}

function conflictPath(path: string, revision: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const suffix = `.sync-conflict-${revision.replace(/[^a-z0-9-]/gi, '').slice(0, 16)}`;
  return dot > slash ? `${path.slice(0, dot)}${suffix}${path.slice(dot)}` : `${path}${suffix}`;
}

function isConflictCopy(path: string): boolean {
  return /\.sync-conflict-[^/]+(?:\.[^/]*)?$/i.test(path);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

export class KosLiveSyncEngine implements KosSyncEngine {
  private database: KosLiveSyncDatabase | null = null;
  private journal: JournalSyncCore | null = null;
  private storage: KosJournalStorage | null = null;
  private state: KosLiveSyncPersistedState = { vaultId: '', checkpoints: {}, reflection: {} };
  private progress: (progress: KosSyncProgress) => void = () => undefined;
  private paused = false;
  private running: Promise<void> | null = null;
  private rerunRequested = false;
  private stateLoaded = false;
  private bootstrapLocalPaths: Set<string> | null = null;
  private bootstrapCandidate = false;

  constructor(
    private readonly vault: KosSyncVaultPort,
    private readonly stateRepository: KosLiveSyncStateRepository,
    private readonly storageFactory: (settings: Readonly<KosSyncSettings>) => KosJournalStorage,
    private readonly databaseName: (vaultId: string) => string = (vaultId) => `kos-sync-${vaultId}`,
  ) {}

  async start(
    settings: Readonly<KosSyncSettings>,
    onProgress: (progress: KosSyncProgress) => void,
  ): Promise<void> {
    this.progress = onProgress;
    this.paused = false;
    const loadedState = await this.stateRepository.load();
    this.bootstrapCandidate = loadedState.vaultId !== settings.vaultId
      || (
        Object.keys(loadedState.reflection).length === 0
        && Object.keys(loadedState.checkpoints).length === 0
      );
    this.state = loadedState.vaultId === settings.vaultId
      ? loadedState
      : { vaultId: settings.vaultId, checkpoints: {}, reflection: {} };
    this.stateLoaded = true;
    this.storage = this.storageFactory(settings);
    if (!await this.storage.isAvailable()) throw new Error('无法连接 Cloudflare R2 Bucket');

    const upstreamSettings = {
      ...DEFAULT_SETTINGS,
      endpoint: kosSyncEndpoint(settings.accountId),
      bucket: settings.bucket,
      bucketPrefix: kosSyncBucketPrefix(settings.vaultId),
      region: 'auto',
      accessKey: settings.accessKeyId,
      secretKey: settings.secretAccessKey,
      encrypt: false,
      passphrase: '',
      usePathObfuscation: false,
      useIndexedDBAdapter: true,
      disableWorkerForGeneratingChunks: true,
      processSmallFilesInUIThread: true,
    };
    this.database = new KosLiveSyncDatabase(
      this.databaseName(settings.vaultId),
      (name, options) => new PouchDB(name, { ...options, adapter: 'indexeddb' }),
      upstreamSettings,
    );
    await this.database.open();
    const databaseInfo = await this.database.local.localDatabase.info();
    if (
      databaseInfo.doc_count === 0
      && (
        Object.keys(this.state.checkpoints).length > 0
        || Object.keys(this.state.reflection).length > 0
      )
    ) {
      // IndexedDB belongs to the Obsidian browser profile, while sync-state is
      // stored in the Vault plugin directory. If the profile storage is
      // cleared or rebuilt, retaining its old checkpoint would silently mark
      // records from the new empty database as already sent. Re-enter the safe
      // remote-first bootstrap instead.
      this.state = {
        vaultId: settings.vaultId,
        checkpoints: {},
        reflection: {},
      };
      this.bootstrapCandidate = true;
      await this.stateRepository.save(this.state);
    }

    const checkpointStore: LiveSyncSimpleStore = {
      get: async (key) => cloneCheckpoint(this.state.checkpoints[key] ?? emptyCheckpoint()),
      set: async (key, value) => {
        this.state.checkpoints[key] = cloneCheckpoint(value);
        await this.stateRepository.save(this.state);
      },
      delete: async (key) => {
        delete this.state.checkpoints[key];
        await this.stateRepository.save(this.state);
      },
      keys: async () => Object.keys(this.state.checkpoints),
    };
    const replicationStatics = {
      value: {
        sent: 0,
        arrived: 0,
        maxPullSeq: 0,
        maxPushSeq: 0,
        lastSyncPullSeq: 0,
        lastSyncPushSeq: 0,
        syncStatus: 'NOT_CONNECTED',
      },
    };
    const environment = {
      services: {
        database: { localDatabase: this.database.local },
        setting: { currentSettings: () => this.database!.settings },
        replicator: { replicationStatics },
        replication: { parseSynchroniseResult: async () => true },
      },
    };
    this.journal = new JournalSyncCore(
      pickBucketSyncSettings(upstreamSettings),
      checkpointStore,
      environment,
      new KosLiveSyncJournalStorage(this.storage),
    );
    this.journal.processReplication = async (documents) => await this.applyRemoteDocuments(documents);
    await this.ensureRemoteProtocol();
    await this.sync();
  }

  async sync(): Promise<void> {
    if (this.paused) return;
    if (!this.database || !this.journal) throw new Error('kos-sync 同步引擎尚未初始化');
    if (this.running) {
      this.rerunRequested = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.rerunRequested = false;
        await this.runSync();
      } while (this.rerunRequested && !this.paused);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async pause(): Promise<void> {
    this.paused = true;
    this.journal?.requestStop();
    await this.running;
  }

  async resume(): Promise<void> {
    this.paused = false;
  }

  async stop(): Promise<void> {
    this.paused = true;
    this.journal?.requestStop();
    await this.running;
    if (this.stateLoaded) await this.stateRepository.save(this.state);
    await this.database?.close();
    const destroyable = this.storage as KosJournalStorage & { destroy?: () => void };
    destroyable?.destroy?.();
    this.database = null;
    this.journal = null;
    this.storage = null;
    this.stateLoaded = false;
  }

  private async runSync(): Promise<void> {
    if (
      this.bootstrapCandidate
      && await this.hasRemoteJournal()
    ) {
      const localFiles = (await this.vault.listFiles())
        .filter((file) => isKosSyncPathIncluded(file.path));
      this.bootstrapLocalPaths = new Set(localFiles.map((file) => file.path));
      this.progress({
        pendingUploads: 0,
        pendingDownloads: 0,
        message: '正在安全加入远端 Vault',
      });
      try {
        const received = await this.journal!.sync();
        if (received !== true) {
          if (this.paused) return;
          throw new Error('LiveSync Journal 首次接收失败');
        }
      } finally {
        this.bootstrapLocalPaths = null;
      }
    }
    this.bootstrapCandidate = false;

    const changed = await this.reflectVaultIntoDatabase();
    this.progress({
      pendingUploads: changed,
      pendingDownloads: 0,
      message: changed > 0 ? `正在上传 ${changed} 个本地变更` : '正在检查远端变更',
    });
    const result = await this.journal!.sync();
    if (result !== true) {
      if (this.paused) return;
      throw new Error('LiveSync Journal 同步失败');
    }
    await this.stateRepository.save(this.state);
    const conflicts = (await this.vault.listFiles())
      .filter((file) => isKosSyncPathIncluded(file.path) && isConflictCopy(file.path))
      .length;
    this.progress({
      pendingUploads: 0,
      pendingDownloads: 0,
      conflicts,
      message: '同步完成',
    });
  }

  private async hasRemoteJournal(): Promise<boolean> {
    const files = await this.storage!.listFiles();
    return files.some((path) => /-docs\.jsonl\.gz$/i.test(path));
  }

  private async ensureRemoteProtocol(): Promise<void> {
    try {
      await this.journal!.getSyncParameters();
    } catch {
      const initial = await this.journal!.getInitialSyncParameters();
      if (!await this.journal!.putSyncParameters(initial)) {
        throw new Error('无法初始化 LiveSync Journal 协议参数');
      }
    }
    await this.journal!.ensureCheckpointCachesAreFresh();
  }

  private async reflectVaultIntoDatabase(): Promise<number> {
    const files = (await this.vault.listFiles()).filter((file) => isKosSyncPathIncluded(file.path));
    const current = new Map(files.map((file) => [file.path, file]));
    let changed = 0;
    for (const file of files) {
      const known = this.state.reflection[file.path];
      if (known && known.mtime === file.mtime && known.size === file.size) continue;
      await this.database!.put(
        file.path,
        await this.vault.read(file.path),
        file.mtime,
        file.ctime,
        mimeForPath(file.path),
      );
      this.state.reflection[file.path] = {
        ctime: file.ctime,
        mtime: file.mtime,
        size: file.size,
      };
      changed += 1;
    }
    for (const path of Object.keys(this.state.reflection)) {
      if (current.has(path) || !isKosSyncPathIncluded(path)) continue;
      if (await this.database!.get(path)) await this.database!.delete(path);
      delete this.state.reflection[path];
      changed += 1;
    }
    await this.stateRepository.save(this.state);
    return changed;
  }

  private async applyRemoteDocuments(documents: LiveSyncLoadedEntry[]): Promise<boolean> {
    let applied = 0;
    let conflicts = 0;
    let remaining = documents.filter((document) => document.path && isKosSyncPathIncluded(document.path)).length;
    if (remaining > 0) {
      this.progress({ pendingDownloads: remaining, message: `准备应用 ${remaining} 个远端变更` });
    }
    for (const document of documents) {
      const path = document.path;
      if (!path || !isKosSyncPathIncluded(path)) continue;
      const revisions = await this.database!.conflicts(path);
      const remoteDeleted = Boolean(document.deleted || document._deleted);
      let bootstrapLocal: Uint8Array | false = false;
      if (this.bootstrapLocalPaths?.has(path)) {
        try {
          bootstrapLocal = await this.vault.read(path);
        } catch {
          bootstrapLocal = false;
        }
      }

      // PouchDB can keep the live local branch as the winning revision when a
      // concurrent remote deletion arrives. KOS makes deletion deterministic:
      // preserve the live branch as a normal conflict file, then tombstone the
      // primary path so it cannot be resurrected on the next pass.
      if (remoteDeleted && revisions.length > 0) {
        const live = await this.database!.read(path);
        if (live !== false) {
          const remoteRevision = (document as { _rev?: string })._rev ?? `delete-${document.mtime}`;
          const preservedPath = conflictPath(path, remoteRevision);
          await this.vault.write(preservedPath, live, document.ctime, document.mtime);
          // Keep it absent from reflection so the queued/next pass uploads it.
          conflicts += 1;
        }
      }
      if (remoteDeleted && bootstrapLocal !== false) {
        const remoteRevision = (document as { _rev?: string })._rev ?? `delete-${document.mtime}`;
        await this.vault.write(
          conflictPath(path, remoteRevision),
          bootstrapLocal,
          document.ctime,
          document.mtime,
        );
        conflicts += 1;
      }
      for (const revision of revisions) {
        const conflict = await this.database!.readRevision(path, revision);
        if (conflict !== false) {
          const current = await this.database!.read(path);
          if (current === false || !bytesEqual(current, conflict)) {
            const preservedPath = conflictPath(path, revision);
            await this.vault.write(preservedPath, conflict, document.ctime, document.mtime);
            // Deliberately leave this path out of reflection state. The next
            // automatic pass must ingest and upload the preserved conflict copy.
            conflicts += 1;
          }
        }
        await this.database!.resolveRevision(path, revision);
      }
      if (remoteDeleted) {
        if (await this.database!.get(path)) await this.database!.delete(path);
        await this.vault.delete(path);
        delete this.state.reflection[path];
      } else {
        const data = await this.database!.read(path);
        if (data === false) {
          await this.vault.delete(path);
          delete this.state.reflection[path];
          applied += 1;
          continue;
        }
        if (bootstrapLocal !== false && !bytesEqual(data, bootstrapLocal)) {
          const remoteRevision = (document as { _rev?: string })._rev ?? `join-${document.mtime}`;
          await this.vault.write(
            conflictPath(path, remoteRevision),
            bootstrapLocal,
            document.ctime,
            document.mtime,
          );
          conflicts += 1;
        }
        const written = await this.vault.write(path, data, document.ctime, document.mtime);
        this.state.reflection[path] = {
          ctime: written.ctime,
          mtime: written.mtime,
          size: written.size,
        };
      }
      applied += 1;
      remaining -= 1;
      this.progress({
        pendingDownloads: remaining,
        conflicts,
        message: conflicts > 0
          ? `正在应用远端变更，剩余 ${remaining} 个；已保留 ${conflicts} 个冲突副本`
          : remaining > 0
            ? `正在应用远端变更，剩余 ${remaining} 个`
            : `已应用 ${applied} 个远端变更`,
      });
    }
    await this.stateRepository.save(this.state);
    return true;
  }
}
