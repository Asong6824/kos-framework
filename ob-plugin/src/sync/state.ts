import type {
  KosLiveSyncPersistedState,
  KosLiveSyncStateRepository,
} from './livesync-engine';
import type { LiveSyncCheckpoint } from './upstream/livesync-runtime.js';

interface SerializedCheckpoint {
  lastLocalSeq: number | string;
  journalEpoch: string;
  knownIDs: string[];
  sentIDs: string[];
  receivedFiles: string[];
  sentFiles: string[];
}

interface SerializedState {
  version: 1 | 2;
  vaultId?: string;
  checkpoints: Record<string, SerializedCheckpoint>;
  reflection: KosLiveSyncPersistedState['reflection'];
}

function serializeCheckpoint(checkpoint: LiveSyncCheckpoint): SerializedCheckpoint {
  return {
    ...checkpoint,
    knownIDs: [...checkpoint.knownIDs],
    sentIDs: [...checkpoint.sentIDs],
    receivedFiles: [...checkpoint.receivedFiles],
    sentFiles: [...checkpoint.sentFiles],
  };
}

function deserializeCheckpoint(checkpoint: SerializedCheckpoint): LiveSyncCheckpoint {
  return {
    ...checkpoint,
    knownIDs: new Set(checkpoint.knownIDs),
    sentIDs: new Set(checkpoint.sentIDs),
    receivedFiles: new Set(checkpoint.receivedFiles),
    sentFiles: new Set(checkpoint.sentFiles),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function parseReflection(value: unknown): KosLiveSyncPersistedState['reflection'] | null {
  if (!isRecord(value)) return null;
  const reflection: KosLiveSyncPersistedState['reflection'] = {};
  for (const [path, entry] of Object.entries(value)) {
    if (!isRecord(entry)) return null;
    const { ctime, mtime, size } = entry;
    if (
      typeof ctime !== 'number' || !Number.isFinite(ctime)
      || typeof mtime !== 'number' || !Number.isFinite(mtime)
      || typeof size !== 'number' || !Number.isFinite(size)
    ) return null;
    reflection[path] = { ctime, mtime, size };
  }
  return reflection;
}

export function emptyKosLiveSyncState(vaultId = ''): KosLiveSyncPersistedState {
  return { vaultId, checkpoints: {}, reflection: {} };
}

export function parseKosLiveSyncState(raw: string): KosLiveSyncPersistedState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isRecord(parsed)
    || (parsed.version !== 1 && parsed.version !== 2)
    || !isRecord(parsed.checkpoints)
  ) return null;
  if (parsed.version === 2 && typeof parsed.vaultId !== 'string') return null;
  const checkpoints: Record<string, LiveSyncCheckpoint> = {};
  for (const [key, value] of Object.entries(parsed.checkpoints)) {
    if (!isRecord(value)) return null;
    const candidate = value as unknown as SerializedCheckpoint;
    if (
      (typeof candidate.lastLocalSeq !== 'number' && typeof candidate.lastLocalSeq !== 'string')
      || typeof candidate.journalEpoch !== 'string'
      || !isStringArray(candidate.knownIDs)
      || !isStringArray(candidate.sentIDs)
      || !isStringArray(candidate.receivedFiles)
      || !isStringArray(candidate.sentFiles)
    ) return null;
    checkpoints[key] = deserializeCheckpoint(candidate);
  }
  const reflection = parseReflection(parsed.reflection);
  return reflection ? {
    vaultId: parsed.version === 2 ? parsed.vaultId as string : '',
    checkpoints,
    reflection,
  } : null;
}

export function serializeKosLiveSyncState(state: KosLiveSyncPersistedState): string {
  const checkpoints = Object.fromEntries(
    Object.entries(state.checkpoints).map(([key, value]) => [key, serializeCheckpoint(value)]),
  );
  const serialized: SerializedState = {
    version: 2,
    vaultId: state.vaultId,
    checkpoints,
    reflection: state.reflection,
  };
  return JSON.stringify(serialized);
}

export interface KosSyncStateFilePort {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  rename(path: string, newPath: string): Promise<void>;
}

export class KosFileSyncStateRepository implements KosLiveSyncStateRepository {
  constructor(
    private readonly files: KosSyncStateFilePort,
    private readonly path: string,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<KosLiveSyncPersistedState> {
    if (!await this.files.exists(this.path)) return emptyKosLiveSyncState();
    const state = parseKosLiveSyncState(await this.files.read(this.path));
    if (state) return state;
    const quarantine = `${this.path}.corrupt-${this.now()}`;
    try {
      await this.files.rename(this.path, quarantine);
    } catch {
      throw new Error('kos-sync checkpoint 已损坏且无法隔离；同步已停止，原文件未覆盖');
    }
    return emptyKosLiveSyncState();
  }

  async save(state: KosLiveSyncPersistedState): Promise<void> {
    await this.files.write(this.path, serializeKosLiveSyncState(state));
  }
}
