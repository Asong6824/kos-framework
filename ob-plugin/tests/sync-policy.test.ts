import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KOS_SYNC_SETTINGS, normalizeKosSyncSettings } from '../src/sync/model';
import {
  ensureKosSyncVaultId,
  isKosSyncPathIncluded,
  kosSyncBucketPrefix,
  kosSyncEndpoint,
  validateKosSyncSettings,
} from '../src/sync/policy';

describe('kos-sync fixed policy', () => {
  it('keeps valid Vault IDs and replaces unsafe values', () => {
    const id = randomUUID();
    expect(ensureKosSyncVaultId(id, randomUUID)).toBe(id);
    expect(ensureKosSyncVaultId('../unsafe', randomUUID)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('derives the R2 endpoint and isolated bucket prefix', () => {
    const id = randomUUID();
    expect(kosSyncEndpoint('0123456789abcdef0123456789ABCDEF')).toBe(
      'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    );
    expect(kosSyncBucketPrefix(id)).toBe(`kos-sync/v1/${id}/`);
  });

  it('never includes system-controlled or hidden paths', () => {
    expect(isKosSyncPathIncluded('10_输入/文章.md')).toBe(true);
    expect(isKosSyncPathIncluded('.obsidian/plugins/kos-companion/data.json')).toBe(false);
    expect(isKosSyncPathIncluded('.git/config')).toBe(false);
    expect(isKosSyncPathIncluded('.kos.md')).toBe(false);
    expect(isKosSyncPathIncluded('90_系统/framework-backups/old.md')).toBe(false);
  });

  it('normalizes legacy or malformed stored settings', () => {
    expect(normalizeKosSyncSettings(undefined)).toEqual(DEFAULT_KOS_SYNC_SETTINGS);
    expect(normalizeKosSyncSettings({
      enabled: true,
      accountId: ' abc ',
      bucket: 12,
      accessKeyId: ' key ',
      secretAccessKey: ' secret ',
      vaultId: 'ABC',
      paused: true,
    })).toEqual({
      enabled: true,
      accountId: 'abc',
      bucket: '',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      vaultId: 'abc',
      paused: true,
    });
  });

  it('requires complete private R2 configuration only when enabled', () => {
    expect(validateKosSyncSettings(DEFAULT_KOS_SYNC_SETTINGS).valid).toBe(true);
    const valid = {
      ...DEFAULT_KOS_SYNC_SETTINGS,
      enabled: true,
      accountId: '0123456789abcdef0123456789abcdef',
      bucket: 'kos-vault',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      vaultId: randomUUID(),
    };
    expect(validateKosSyncSettings(valid)).toEqual({ valid: true, message: '配置有效' });
    expect(validateKosSyncSettings({ ...valid, bucket: '' }).valid).toBe(false);
  });
});
