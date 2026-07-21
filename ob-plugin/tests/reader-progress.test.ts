import { describe, expect, it } from 'vitest';
import { normalizeReaderProgressRecord } from '../src/reader/model';

describe('reader progress migration', () => {
  it('defaults missing legacy data to an empty record', () => {
    expect(normalizeReaderProgressRecord(undefined)).toEqual({});
    expect(normalizeReaderProgressRecord(null)).toEqual({});
  });

  it('retains valid entries and rejects damaged entries', () => {
    expect(normalizeReaderProgressRecord({
      '10_输入/source.md': {
        kind: 'epub',
        location: 'epubcfi(/6/4!/4/2)',
        progress: 1.4,
        updatedAt: '2026-07-21T00:00:00.000Z',
      },
      broken: { kind: 'video', location: 3 },
    })).toEqual({
      '10_输入/source.md': {
        kind: 'epub',
        location: 'epubcfi(/6/4!/4/2)',
        progress: 1,
        updatedAt: '2026-07-21T00:00:00.000Z',
      },
    });
  });
});
