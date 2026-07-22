import { describe, expect, it } from 'vitest';
import {
  BENTO_COLUMNS,
  bentoLayoutRows,
  DEFAULT_BENTO_LAYOUT,
  isDefaultBentoLayout,
  migrateLegacyDashboardLayout,
  moveBentoItem,
  normalizeBentoLayout,
  resizeBentoItem,
  resizeBentoItemFromEdges,
  resolveBentoLayout,
  UTILITY_MINIMUM_ROWS,
} from '../src/core/bento-layout';
import type { BentoLayoutItem, BentoMinimumRows } from '../src/core/bento-layout';

function overlapFree(layout: BentoLayoutItem[], minimumRows: BentoMinimumRows = {}): boolean {
  return layout.every((a, index) => layout.slice(index + 1).every((b) => {
    const aRows = Math.max(a.h, minimumRows[a.id] ?? 1);
    const bRows = Math.max(b.h, minimumRows[b.id] ?? 1);
    return a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + aRows <= b.y || b.y + bRows <= a.y;
  }));
}

describe('unified Bento layout engine', () => {
  it('normalizes missing or invalid layouts to the complete ten-card default', () => {
    expect(BENTO_COLUMNS).toBe(12);
    expect(DEFAULT_BENTO_LAYOUT).toHaveLength(10);
    expect(normalizeBentoLayout(null)).toEqual(DEFAULT_BENTO_LAYOUT);
    expect(normalizeBentoLayout([{ id: 'today', x: 99, y: -2, w: 18, h: 0 }])).toEqual(DEFAULT_BENTO_LAYOUT);
    expect(isDefaultBentoLayout(normalizeBentoLayout(DEFAULT_BENTO_LAYOUT))).toBe(true);
  });

  it('clamps moves to twelve columns and pushes colliding cards down', () => {
    const moved = moveBentoItem(DEFAULT_BENTO_LAYOUT, 'today', 8, 37, UTILITY_MINIMUM_ROWS);
    const today = moved.find((item) => item.id === 'today')!;
    const knowledge = moved.find((item) => item.id === 'knowledge')!;
    expect(today).toMatchObject({ x: 3, y: 37, w: 9 });
    expect(knowledge.y).toBeGreaterThanOrEqual(today.y + today.h);
    expect(overlapFree(moved, UTILITY_MINIMUM_ROWS)).toBe(true);
  });

  it('resizes every card in whole Bento cells and keeps runtime content floors separate', () => {
    const resized = resizeBentoItem(DEFAULT_BENTO_LAYOUT, 'knowledge', 9, 1, { knowledge: 4 });
    const knowledge = resized.find((item) => item.id === 'knowledge')!;
    expect(knowledge).toMatchObject({ x: 9, w: 3, h: 1 });
    expect(resolveBentoLayout(resized, { knowledge: 4 })).toContainEqual(knowledge);
    expect(bentoLayoutRows(resized, { knowledge: 4 })).toBeGreaterThanOrEqual(4);

    const clock = resizeBentoItem(DEFAULT_BENTO_LAYOUT, 'clock', 5, 6, UTILITY_MINIMUM_ROWS)
      .find((item) => item.id === 'clock');
    expect(clock).toMatchObject({ w: 5, h: 6 });
  });

  it('resizes from the west edge while keeping the right edge fixed', () => {
    const resized = resizeBentoItemFromEdges(DEFAULT_BENTO_LAYOUT, 'knowledge', 'w', -2, 0);
    const knowledge = resized.find((item) => item.id === 'knowledge')!;
    expect(knowledge).toMatchObject({ x: 7, w: 5 });
    expect(knowledge.x + knowledge.w).toBe(12);
  });

  it('resizes from the north edge while keeping the visible bottom edge fixed', () => {
    const resized = resizeBentoItemFromEdges(DEFAULT_BENTO_LAYOUT, 'action', 'n', 0, 1);
    const action = resized.find((item) => item.id === 'action')!;
    expect(action).toMatchObject({ y: 45, h: 9 });
    expect(action.y + action.h).toBe(54);
  });

  it('clamps horizontal edge resizing to twelve columns and one-column width', () => {
    const expanded = resizeBentoItemFromEdges(DEFAULT_BENTO_LAYOUT, 'today', 'e', 20, 0);
    const narrowed = resizeBentoItemFromEdges(DEFAULT_BENTO_LAYOUT, 'today', 'w', 20, 0);
    expect(expanded.find((item) => item.id === 'today')).toMatchObject({ x: 0, w: 12 });
    expect(narrowed.find((item) => item.id === 'today')).toMatchObject({ x: 8, w: 1 });
  });

  it('uses displayed rows as the resize baseline and enforces the content floor', () => {
    const resized = resizeBentoItemFromEdges(
      DEFAULT_BENTO_LAYOUT,
      'today',
      's',
      0,
      -3,
      { today: 6 },
      { today: 9 },
    );
    expect(resized.find((item) => item.id === 'today')?.h).toBe(6);
  });

  it('resizes utility cards through the same corner and collision logic', () => {
    const resized = resizeBentoItemFromEdges(
      DEFAULT_BENTO_LAYOUT,
      'progress',
      'se',
      2,
      2,
      UTILITY_MINIMUM_ROWS,
      { progress: 12 },
    );
    expect(resized.find((item) => item.id === 'progress')).toMatchObject({ x: 0, w: 12, h: 14 });
    expect(resized.find((item) => item.id === 'heatmap')?.y).toBeGreaterThanOrEqual(32);
    expect(overlapFree(resized, UTILITY_MINIMUM_ROWS)).toBe(true);
  });

  it('reflows later cards when measured content grows without changing preferred sizes', () => {
    const minimumRows = { ...UTILITY_MINIMUM_ROWS, today: 9, knowledge: 9, action: 10, input: 12, review: 7, system: 7 };
    const resolved = resolveBentoLayout(DEFAULT_BENTO_LAYOUT, minimumRows);
    expect(resolved.find((item) => item.id === 'action')?.y).toBe(46);
    expect(resolved.find((item) => item.id === 'input')?.y).toBe(46);
    expect(resolved.find((item) => item.id === 'review')?.y).toBe(58);
    expect(resolved.find((item) => item.id === 'system')?.y).toBe(58);
    expect(resolved.map(({ id, w, h }) => ({ id, w, h }))).toEqual(
      normalizeBentoLayout(DEFAULT_BENTO_LAYOUT).map(({ id, w, h }) => ({ id, w, h })),
    );
    expect(overlapFree(resolved, minimumRows)).toBe(true);
  });

  it('migrates v5 pixel widgets and four-column business cards into one grid', () => {
    const legacyBusiness = [
      { id: 'today', x: 0, y: 0, w: 3, h: 2 },
      { id: 'knowledge', x: 3, y: 0, w: 1, h: 2 },
      { id: 'action', x: 0, y: 2, w: 2, h: 3 },
      { id: 'input', x: 2, y: 2, w: 2, h: 3 },
      { id: 'review', x: 0, y: 5, w: 3, h: 2 },
      { id: 'system', x: 3, y: 5, w: 1, h: 2 },
    ];
    const legacyWidgets = {
      clock: { width: 812, height: 443 },
      schedule: { width: 812, height: 540 },
      progress: { width: 1182, height: 682 },
      heatmap: { width: 1182, height: 390 },
    };
    const migrated = migrateLegacyDashboardLayout(legacyBusiness, legacyWidgets);
    expect(migrated).toHaveLength(10);
    expect(migrated.find((item) => item.id === 'clock')).toMatchObject({ x: 0, y: 0, w: 7, h: 8 });
    expect(migrated.find((item) => item.id === 'progress')).toMatchObject({ w: 10, h: 12 });
    expect(migrated.find((item) => item.id === 'today')).toMatchObject({ x: 0, y: 37, w: 9, h: 7 });
    expect(migrated.find((item) => item.id === 'system')).toMatchObject({ x: 9, w: 3, h: 7 });
    expect(overlapFree(migrated, UTILITY_MINIMUM_ROWS)).toBe(true);
  });
});
