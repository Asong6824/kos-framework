import { describe, expect, it } from 'vitest';
import type { KosSyncSettings } from '../src/sync/model';
import { createKosSyncJoinCode, parseKosSyncJoinCode } from '../src/sync/pairing';

function settings(): KosSyncSettings {
  return {
    enabled: true,
    accountId: '0123456789abcdef0123456789abcdef',
    bucket: 'kos-private-vault',
    accessKeyId: 'device-access',
    secretAccessKey: 'device-secret',
    vaultId: '123e4567-e89b-42d3-a456-426614174000',
    paused: false,
  };
}

describe('kos-sync device join code', () => {
  it('round-trips the shared R2 prefix and credentials in one code', () => {
    const value = settings();
    expect(parseKosSyncJoinCode(createKosSyncJoinCode(value))).toEqual(value);
  });

  it('rejects malformed and incomplete codes without echoing their content', () => {
    expect(() => parseKosSyncJoinCode('not-a-code')).toThrow('不是有效的 kos-sync 设备加入码');
    expect(() => parseKosSyncJoinCode('KOS-SYNC1.invalid')).toThrow('加入码不完整或复制时被截断');
    expect(() => parseKosSyncJoinCode(`${createKosSyncJoinCode(settings()).slice(0, 40)}\n\`\`\``))
      .toThrow('加入码不完整或复制时被截断');
  });
});
