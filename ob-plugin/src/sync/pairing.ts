import { normalizeKosSyncSettings, type KosSyncSettings } from './model';
import { validateKosSyncSettings } from './policy';

const JOIN_CODE_PREFIX = 'KOS-SYNC1.';

interface KosSyncJoinPayload {
  version: 1;
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  vaultId: string;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export function createKosSyncJoinCode(settings: Readonly<KosSyncSettings>): string {
  const validation = validateKosSyncSettings(settings);
  if (!settings.enabled || !validation.valid) {
    throw new Error(validation.valid ? '请先启用多端同步' : validation.message);
  }
  const payload: KosSyncJoinPayload = {
    version: 1,
    accountId: settings.accountId,
    bucket: settings.bucket,
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    vaultId: settings.vaultId,
  };
  return `${JOIN_CODE_PREFIX}${encodeBase64Url(JSON.stringify(payload))}`;
}

export function parseKosSyncJoinCode(code: string): KosSyncSettings {
  const trimmed = code.trim();
  if (!trimmed.startsWith(JOIN_CODE_PREFIX)) throw new Error('不是有效的 kos-sync 设备加入码');
  const encoded = trimmed.slice(JOIN_CODE_PREFIX.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error('kos-sync 加入码不完整或复制时被截断；请从第一台设备重新整行复制');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(encoded));
  } catch {
    throw new Error('kos-sync 加入码不完整或复制时被截断；请从第一台设备重新整行复制');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('kos-sync 设备加入码格式无效');
  }
  const payload = parsed as Partial<KosSyncJoinPayload>;
  if (payload.version !== 1) throw new Error('不支持的 kos-sync 设备加入码版本');
  const settings = normalizeKosSyncSettings({
    enabled: true,
    paused: false,
    accountId: payload.accountId,
    bucket: payload.bucket,
    accessKeyId: payload.accessKeyId,
    secretAccessKey: payload.secretAccessKey,
    vaultId: payload.vaultId,
  });
  const validation = validateKosSyncSettings(settings);
  if (!validation.valid) throw new Error(`设备加入码配置无效：${validation.message}`);
  return settings;
}
