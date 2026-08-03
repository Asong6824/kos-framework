import { describe, expect, it } from 'vitest';
import type { KosSyncSettings } from '../src/sync/model';
import {
  explainKosSyncPreflightFailure,
  kosSyncConfigurationFingerprint,
  validateKosSyncPreflightSettings,
} from '../src/sync/preflight';

function settings(): KosSyncSettings {
  return {
    enabled: false,
    accountId: '0123456789abcdef0123456789abcdef',
    bucket: 'kos-vault',
    accessKeyId: 'access-key',
    secretAccessKey: 'very-secret-value',
    vaultId: 'a1f32833-b121-4ba7-bb57-9f5e9899c1be',
    paused: false,
  };
}

describe('kos sync preflight', () => {
  it('creates a stable non-secret fingerprint and changes it with credentials', async () => {
    const source = settings();
    const first = await kosSyncConfigurationFingerprint(source);
    const second = await kosSyncConfigurationFingerprint({ ...source });
    const changed = await kosSyncConfigurationFingerprint({ ...source, secretAccessKey: 'rotated-secret' });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(source.secretAccessKey);
    expect(changed).not.toBe(first);
  });

  it('validates complete credentials before sync is enabled', () => {
    expect(() => validateKosSyncPreflightSettings(settings())).not.toThrow();
  });

  it('returns actionable errors without echoing provider messages or secrets', () => {
    const secret = settings().secretAccessKey;
    const explained = explainKosSyncPreflightFailure(new Error(`network failed with ${secret}`));
    expect(explained).toContain('无法连接 R2');
    expect(explained).not.toContain(secret);
    expect(explainKosSyncPreflightFailure({ $metadata: { httpStatusCode: 403 } })).toContain('权限不足');
  });
});
