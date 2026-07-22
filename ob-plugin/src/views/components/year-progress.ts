import { yearProgressSnapshot } from '../../core/metrics';
import type { ProgressPeriod } from '../../core/metrics';

const SEGMENT_COUNT = 50;

export interface YearProgressHandle {
  root: HTMLElement;
  update(now?: Date): void;
}

function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function formatProgress(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function progressSegments(value: number): number {
  return Math.round(clampProgress(value) * SEGMENT_COUNT);
}

export function renderYearProgress(parent: HTMLElement, initialNow = new Date()): YearProgressHandle {
  const root = parent.createEl('section', {
    cls: 'kos-year-progress',
    attr: { role: 'timer', 'aria-live': 'off' },
  });
  const header = root.createDiv({ cls: 'kos-year-progress-head' });
  header.createSpan({ text: 'PROGRESS' });
  const era = header.createSpan({ cls: 'kos-year-progress-era' });

  const hero = root.createDiv({ cls: 'kos-year-progress-hero' });
  const heroValue = hero.createSpan({ cls: 'kos-year-progress-hero-value' });
  hero.createSpan({ cls: 'kos-year-progress-hero-label', text: 'YEAR' });

  const periods: ProgressPeriod[] = ['year', 'month', 'week', 'day'];
  const valueElements = new Map<ProgressPeriod, HTMLElement>();
  const segmentElements = new Map<ProgressPeriod, HTMLElement[]>();
  let yearCount: HTMLElement | null = null;

  for (const period of periods) {
    const row = root.createDiv({ cls: 'kos-year-progress-row', attr: { 'data-period': period } });
    const rowHead = row.createDiv({ cls: 'kos-year-progress-row-head' });
    rowHead.createSpan({ cls: 'kos-year-progress-period', text: period.toUpperCase() });
    const stats = rowHead.createSpan({ cls: 'kos-year-progress-stats' });
    const value = stats.createSpan({ cls: 'kos-year-progress-value' });
    valueElements.set(period, value);
    if (period === 'year') {
      stats.createSpan({ cls: 'kos-year-progress-separator', text: '·' });
      yearCount = stats.createSpan({ cls: 'kos-year-progress-count' });
    }
    const rail = row.createDiv({ cls: 'kos-year-progress-rail', attr: { 'aria-hidden': 'true' } });
    segmentElements.set(period, Array.from({ length: SEGMENT_COUNT }, () => rail.createSpan()));
  }

  const update = (now = new Date()): void => {
    const snapshot = yearProgressSnapshot(now);
    const yearValue = formatProgress(snapshot.progress.year);
    era.textContent = `A.D. ${snapshot.year}`;
    heroValue.textContent = yearValue;
    yearCount!.textContent = `${snapshot.dayOfYear}/${snapshot.daysInYear}`;
    for (const period of periods) {
      const progress = snapshot.progress[period];
      valueElements.get(period)!.textContent = formatProgress(progress);
      const filled = progressSegments(progress);
      segmentElements.get(period)!.forEach((segment, index) => segment.classList.toggle('is-filled', index < filled));
    }
    root.dataset.updatedAt = String(now.getTime());
    root.setAttribute(
      'aria-label',
      `${snapshot.year} 年度进度 ${yearValue}，月度 ${formatProgress(snapshot.progress.month)}，周度 ${formatProgress(snapshot.progress.week)}，今日 ${formatProgress(snapshot.progress.day)}`,
    );
  };

  update(initialNow);
  return { root, update };
}
