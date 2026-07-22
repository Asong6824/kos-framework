import { describe, expect, it } from 'vitest';
import { clockSnapshot } from '../src/views/components/dot-clock';

describe('dot clock calendar', () => {
  it('matches the reference date, ISO week, and ordinal day', () => {
    expect(clockSnapshot(new Date(2026, 6, 21, 20, 37, 8))).toEqual({
      hours: '20',
      minutes: '37',
      seconds: '08',
      dateLabel: '2026 年 07 月 21 日 · 星期二',
      week: 30,
      dayOfYear: 202,
      daysInYear: 365,
    });
  });

  it('handles leap-year totals and ISO week-year boundaries', () => {
    expect(clockSnapshot(new Date(2024, 11, 31, 0, 0, 0))).toMatchObject({
      week: 1,
      dayOfYear: 366,
      daysInYear: 366,
    });
  });
});
