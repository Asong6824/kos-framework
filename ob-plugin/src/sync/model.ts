export type KosSyncPhase =
  | 'disabled'
  | 'initializing'
  | 'syncing'
  | 'up-to-date'
  | 'offline'
  | 'paused'
  | 'conflict'
  | 'error';

export interface KosSyncSettings {
  enabled: boolean;
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  vaultId: string;
  paused: boolean;
}

export interface KosSyncSnapshot {
  phase: KosSyncPhase;
  lastAttemptedSync: string | null;
  lastSuccessfulSync: string | null;
  lastSyncDurationMs: number | null;
  pendingUploads: number;
  pendingDownloads: number;
  conflicts: number;
  message: string;
}

export interface KosSyncProgress {
  pendingUploads?: number;
  pendingDownloads?: number;
  conflicts?: number;
  message?: string;
}

export interface KosSyncEngine {
  start(settings: Readonly<KosSyncSettings>, onProgress: (progress: KosSyncProgress) => void): Promise<void>;
  sync(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

export const DEFAULT_KOS_SYNC_SETTINGS: KosSyncSettings = {
  enabled: false,
  accountId: '',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  vaultId: '',
  paused: false,
};

export const DEFAULT_KOS_SYNC_SNAPSHOT: KosSyncSnapshot = {
  phase: 'disabled',
  lastAttemptedSync: null,
  lastSuccessfulSync: null,
  lastSyncDurationMs: null,
  pendingUploads: 0,
  pendingDownloads: 0,
  conflicts: 0,
  message: '未启用',
};

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeKosSyncSettings(value: unknown): KosSyncSettings {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Record<keyof KosSyncSettings, unknown>>
    : {};
  return {
    enabled: candidate.enabled === true,
    accountId: stringValue(candidate.accountId),
    bucket: stringValue(candidate.bucket),
    accessKeyId: stringValue(candidate.accessKeyId),
    secretAccessKey: stringValue(candidate.secretAccessKey),
    vaultId: stringValue(candidate.vaultId).toLowerCase(),
    paused: candidate.paused === true,
  };
}
