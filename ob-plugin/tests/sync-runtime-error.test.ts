import { describe, expect, it } from 'vitest';
import { explainKosSyncRuntimeFailure } from '../src/sync/runtime-error';

describe('kos sync runtime errors', () => {
  it('classifies connectivity failures without echoing provider details', () => {
    const privateMarker = ['runtime', 'redaction', 'marker'].join('-');
    const result = explainKosSyncRuntimeFailure(new Error(`network timeout ${privateMarker}`));
    expect(result.offline).toBe(true);
    expect(result.message).toContain('网络连接失败');
    expect(result.message).not.toContain(privateMarker);
  });

  it('gives actionable permission and retry messages', () => {
    expect(explainKosSyncRuntimeFailure({ $metadata: { httpStatusCode: 403 } }).message).toContain('权限不足');
    expect(explainKosSyncRuntimeFailure(new Error('kos-sync 同步引擎尚未初始化')).message).toContain('重试连接');
  });
});
