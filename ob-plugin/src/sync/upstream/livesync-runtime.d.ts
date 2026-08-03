export interface LiveSyncCheckpoint {
  lastLocalSeq: number | string;
  journalEpoch: string;
  knownIDs: Set<string>;
  sentIDs: Set<string>;
  receivedFiles: Set<string>;
  sentFiles: Set<string>;
}

export interface LiveSyncLoadedEntry {
  _id: string;
  _rev?: string;
  _deleted?: boolean;
  deleted?: boolean;
  path: string;
  mtime: number;
  ctime: number;
  size: number;
  type: string;
  datatype: string;
  data: string | string[];
}

export interface LiveSyncSimpleStore {
  get(key: string): Promise<LiveSyncCheckpoint | undefined>;
  set(key: string, value: LiveSyncCheckpoint): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export const PouchDB: {
  new<T extends object = object>(
    name: string,
    options?: Record<string, unknown>,
  ): {
    destroy(): Promise<unknown>;
  };
};

export class KosLiveSyncDatabase {
  constructor(
    name: string,
    createDatabase: (name: string, options: Record<string, unknown>) => object,
    settings?: Record<string, unknown>,
  );
  readonly local: {
    localDatabase: {
      info(): Promise<{ doc_count: number; update_seq: number | string }>;
    };
    getDBEntryFromMeta(entry: LiveSyncLoadedEntry): Promise<LiveSyncLoadedEntry | false>;
  };
  readonly settings: Record<string, unknown>;
  open(): Promise<void>;
  close(): Promise<void>;
  put(path: string, data: Uint8Array, mtime: number, ctime?: number, mime?: string): Promise<void>;
  get(path: string): Promise<LiveSyncLoadedEntry | false>;
  read(path: string): Promise<Uint8Array | false>;
  conflicts(path: string): Promise<string[]>;
  readRevision(path: string, revision: string): Promise<Uint8Array | false>;
  resolveRevision(path: string, revision: string): Promise<void>;
  delete(path: string): Promise<void>;
}

export class JournalSyncCore {
  constructor(
    settings: Record<string, unknown>,
    store: LiveSyncSimpleStore,
    environment: object,
    storage: object,
  );
  processReplication: (documents: LiveSyncLoadedEntry[]) => Promise<boolean>;
  getInitialSyncParameters(): Promise<Record<string, unknown>>;
  getSyncParameters(): Promise<Record<string, unknown>>;
  putSyncParameters(parameters: Record<string, unknown>): Promise<boolean>;
  ensureCheckpointCachesAreFresh(): Promise<void>;
  sync(showResult?: boolean): Promise<boolean | void>;
  requestStop(): void;
}

export const CheckPointInfoDefault: LiveSyncCheckpoint;
export const DEFAULT_SETTINGS: Record<string, unknown>;
export function pickBucketSyncSettings(settings: Record<string, unknown>): Record<string, unknown>;
