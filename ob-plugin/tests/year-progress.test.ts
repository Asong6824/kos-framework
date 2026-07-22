import { describe, expect, it } from 'vitest';
import { yearProgressSnapshot } from '../src/core/metrics';
import { formatProgress, progressSegments } from '../src/views/components/year-progress';

describe('year progress calendar', () => {
  it('matches elapsed year, month, week, and day time for the reference moment', () => {
    const snapshot = yearProgressSnapshot(new Date(2026, 6, 22, 11, 9, 0));
    expect(snapshot).toMatchObject({ year: 2026, dayOfYear: 203, daysInYear: 365 });
    expect(formatProgress(snapshot.progress.year)).toBe('55.5%');
    expect(formatProgress(snapshot.progress.month)).toBe('69.2%');
    expect(formatProgress(snapshot.progress.week)).toBe('35.2%');
    expect(formatProgress(snapshot.progress.day)).toBe('46.5%');
  });

  it('handles leap years and rounds the 50-segment rail deterministically', () => {
    const snapshot = yearProgressSnapshot(new Date(2024, 11, 31, 12, 0, 0));
    expect(snapshot.daysInYear).toBe(366);
    expect(progressSegments(0)).toBe(0);
    expect(progressSegments(0.555)).toBe(28);
    expect(progressSegments(1)).toBe(50);
  });
});
