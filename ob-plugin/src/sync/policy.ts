import type { KosSyncSettings } from './model';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export const KOS_SYNC_PROTOCOL_VERSION = 1;
export const KOS_SYNC_INTERVAL_MS = 45_000;
export const KOS_SYNC_EXCLUDED_PATHS = [
  '.git/',
  '.obsidian/',
  '.kos.md',
  '.hermes.md',
  '90_系统/framework-backups/',
] as const;

export interface KosSyncValidation {
  valid: boolean;
  message: string;
}

export function ensureKosSyncVaultId(current: string, randomUUID: () => string): string {
  if (UUID_PATTERN.test(current)) return current.toLowerCase();
  const generated = randomUUID();
  if (!UUID_PATTERN.test(generated)) throw new Error('无法生成有效的 kos-sync Vault ID');
  return generated.toLowerCase();
}

export function kosSyncBucketPrefix(vaultId: string): string {
  if (!UUID_PATTERN.test(vaultId)) throw new Error('kos-sync Vault ID 无效');
  return `kos-sync/v${KOS_SYNC_PROTOCOL_VERSION}/${vaultId.toLowerCase()}/`;
}

export function kosSyncEndpoint(accountId: string): string {
  if (!ACCOUNT_ID_PATTERN.test(accountId)) throw new Error('Cloudflare Account ID 应为 32 位十六进制字符串');
  return `https://${accountId.toLowerCase()}.r2.cloudflarestorage.com`;
}

export function isKosSyncPathIncluded(path: string): boolean {
  const normalized = path.replace(/^\/+/, '');
  return !KOS_SYNC_EXCLUDED_PATHS.some((excluded) =>
    excluded.endsWith('/') ? normalized.startsWith(excluded) : normalized === excluded
  );
}

export function validateKosSyncSettings(settings: Readonly<KosSyncSettings>): KosSyncValidation {
  if (!settings.enabled) return { valid: true, message: '未启用' };
  if (!ACCOUNT_ID_PATTERN.test(settings.accountId)) {
    return { valid: false, message: 'Cloudflare Account ID 应为 32 位十六进制字符串' };
  }
  if (!BUCKET_PATTERN.test(settings.bucket)) {
    return { valid: false, message: 'R2 Bucket 名称无效' };
  }
  if (!settings.accessKeyId) return { valid: false, message: '缺少 R2 Access Key ID' };
  if (!settings.secretAccessKey) return { valid: false, message: '缺少 R2 Secret Access Key' };
  if (!UUID_PATTERN.test(settings.vaultId)) return { valid: false, message: 'kos-sync Vault ID 无效' };
  return { valid: true, message: '配置有效' };
}
