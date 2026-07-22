import type { DashboardModule } from './dashboard';

export type DashboardWidgetId = 'clock' | 'schedule' | 'progress' | 'heatmap';
export type DashboardCardId = DashboardWidgetId | DashboardModule;

export const BENTO_COLUMNS = 12;
export const BENTO_ROW_HEIGHT = 42;
export const BENTO_GAP = 16;

export interface BentoLayoutItem {
  id: DashboardCardId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BentoMinimumRows = Partial<Record<DashboardCardId, number>>;

export type BentoResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const DASHBOARD_WIDGET_IDS: DashboardWidgetId[] = ['clock', 'schedule', 'progress', 'heatmap'];
export const DASHBOARD_MODULE_IDS: DashboardModule[] = ['today', 'action', 'input', 'knowledge', 'review', 'system'];
export const DASHBOARD_CARD_IDS: DashboardCardId[] = [...DASHBOARD_WIDGET_IDS, ...DASHBOARD_MODULE_IDS];

export const UTILITY_MINIMUM_ROWS: BentoMinimumRows = {
  clock: 6,
  schedule: 8,
  progress: 9,
  heatmap: 6,
};

export const DEFAULT_BENTO_LAYOUT: BentoLayoutItem[] = [
  { id: 'clock', x: 0, y: 0, w: 7, h: 8 },
  { id: 'schedule', x: 0, y: 8, w: 7, h: 10 },
  { id: 'progress', x: 0, y: 18, w: 10, h: 12 },
  { id: 'heatmap', x: 0, y: 30, w: 10, h: 7 },
  { id: 'today', x: 0, y: 37, w: 9, h: 7 },
  { id: 'knowledge', x: 9, y: 37, w: 3, h: 7 },
  { id: 'action', x: 0, y: 44, w: 6, h: 10 },
  { id: 'input', x: 6, y: 44, w: 6, h: 10 },
  { id: 'review', x: 0, y: 54, w: 9, h: 7 },
  { id: 'system', x: 9, y: 54, w: 3, h: 7 },
];

interface LegacyWidgetItem {
  width?: unknown;
  height?: unknown;
}

const LEGACY_GRID_COLUMNS = 4;
const LEGACY_GRID_STEP = 196;
const REFERENCE_GRID_WIDTH = 1432;
const BENTO_GRID_STEP = BENTO_ROW_HEIGHT + BENTO_GAP;

function integer(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
}

function rounded(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function fallbackItem(id: DashboardCardId): BentoLayoutItem {
  return DEFAULT_BENTO_LAYOUT.find((item) => item.id === id)!;
}

export function cloneBentoLayout(layout: readonly BentoLayoutItem[]): BentoLayoutItem[] {
  return layout.map((item) => ({ ...item }));
}

export function normalizeBentoLayout(value: unknown): BentoLayoutItem[] {
  if (!Array.isArray(value)) return cloneBentoLayout(DEFAULT_BENTO_LAYOUT);
  const byId = new Map<DashboardCardId, BentoLayoutItem>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const raw = candidate as Partial<BentoLayoutItem>;
    if (!DASHBOARD_CARD_IDS.includes(raw.id as DashboardCardId) || byId.has(raw.id as DashboardCardId)) continue;
    const id = raw.id as DashboardCardId;
    const fallback = fallbackItem(id);
    const w = Math.min(BENTO_COLUMNS, Math.max(1, integer(raw.w, fallback.w)));
    const x = Math.min(BENTO_COLUMNS - w, Math.max(0, integer(raw.x, fallback.x)));
    byId.set(id, {
      id,
      x,
      y: Math.max(0, integer(raw.y, fallback.y)),
      w,
      h: Math.max(1, integer(raw.h, fallback.h)),
    });
  }
  if (byId.size !== DASHBOARD_CARD_IDS.length) return cloneBentoLayout(DEFAULT_BENTO_LAYOUT);
  return DASHBOARD_CARD_IDS.map((id) => ({ ...byId.get(id)! }));
}

/** Convert the v5 split layout (4-column business grid + pixel utility cards) into the unified v6 grid. */
export function migrateLegacyDashboardLayout(businessValue: unknown, widgetValue: unknown): BentoLayoutItem[] {
  const widgetSource = widgetValue && typeof widgetValue === 'object' && !Array.isArray(widgetValue)
    ? widgetValue as Partial<Record<DashboardWidgetId, LegacyWidgetItem>>
    : {};
  const columnWidth = (REFERENCE_GRID_WIDTH - (BENTO_COLUMNS - 1) * BENTO_GAP) / BENTO_COLUMNS;
  const horizontalStep = columnWidth + BENTO_GAP;
  const migrated: BentoLayoutItem[] = [];
  let utilityY = 0;

  for (const id of DASHBOARD_WIDGET_IDS) {
    const fallback = fallbackItem(id);
    const legacy = widgetSource[id];
    const fallbackWidth = fallback.w * horizontalStep - BENTO_GAP;
    const fallbackHeight = fallback.h * BENTO_GRID_STEP - BENTO_GAP;
    const w = Math.min(BENTO_COLUMNS, Math.max(1, Math.round((rounded(legacy?.width, fallbackWidth) + BENTO_GAP) / horizontalStep)));
    const h = Math.max(UTILITY_MINIMUM_ROWS[id] ?? 1, Math.round((rounded(legacy?.height, fallbackHeight) + BENTO_GAP) / BENTO_GRID_STEP));
    migrated.push({ id, x: 0, y: utilityY, w, h });
    utilityY += h;
  }

  const legacyItems = Array.isArray(businessValue) ? businessValue : [];
  const byId = new Map<DashboardModule, BentoLayoutItem>();
  for (const candidate of legacyItems) {
    if (!candidate || typeof candidate !== 'object') continue;
    const raw = candidate as Partial<BentoLayoutItem>;
    if (!DASHBOARD_MODULE_IDS.includes(raw.id as DashboardModule) || byId.has(raw.id as DashboardModule)) continue;
    const id = raw.id as DashboardModule;
    const fallback = fallbackItem(id);
    const oldWidth = Math.min(LEGACY_GRID_COLUMNS, Math.max(1, integer(raw.w, Math.max(1, fallback.w / 3))));
    const w = Math.min(BENTO_COLUMNS, oldWidth * 3);
    const oldX = Math.min(LEGACY_GRID_COLUMNS - oldWidth, Math.max(0, integer(raw.x, fallback.x / 3)));
    byId.set(id, {
      id,
      x: Math.min(BENTO_COLUMNS - w, oldX * 3),
      y: utilityY + Math.max(0, Math.round(integer(raw.y, 0) * LEGACY_GRID_STEP / BENTO_GRID_STEP)),
      w,
      h: Math.max(1, Math.round(Math.max(1, integer(raw.h, 1)) * LEGACY_GRID_STEP / BENTO_GRID_STEP)),
    });
  }

  if (byId.size !== DASHBOARD_MODULE_IDS.length) {
    return cloneBentoLayout(DEFAULT_BENTO_LAYOUT);
  }
  migrated.push(...DASHBOARD_MODULE_IDS.map((id) => byId.get(id)!));
  return resolveBentoLayout(migrated, UTILITY_MINIMUM_ROWS);
}

export function isDefaultBentoLayout(layout: readonly BentoLayoutItem[]): boolean {
  const normalized = normalizeBentoLayout(layout);
  return DEFAULT_BENTO_LAYOUT.every((expected) => {
    const item = normalized.find((candidate) => candidate.id === expected.id);
    return item?.x === expected.x && item.y === expected.y && item.w === expected.w && item.h === expected.h;
  });
}

export function effectiveBentoRows(item: BentoLayoutItem, minimumRows: BentoMinimumRows): number {
  return Math.max(item.h, minimumRows[item.id] ?? 1);
}

function overlaps(a: BentoLayoutItem, aRows: number, b: BentoLayoutItem, bRows: number): boolean {
  return a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + bRows
    && a.y + aRows > b.y;
}

export function resolveBentoLayout(
  layout: readonly BentoLayoutItem[],
  minimumRows: BentoMinimumRows = {},
  priorityId?: DashboardCardId,
): BentoLayoutItem[] {
  const normalized = normalizeBentoLayout(layout);
  const order = [...normalized].sort((a, b) => {
    if (a.id === priorityId) return -1;
    if (b.id === priorityId) return 1;
    return a.y - b.y || a.x - b.x || DASHBOARD_CARD_IDS.indexOf(a.id) - DASHBOARD_CARD_IDS.indexOf(b.id);
  });
  const placed: BentoLayoutItem[] = [];
  for (const source of order) {
    const candidate = { ...source };
    let collisions = placed.filter((item) => overlaps(
      candidate,
      effectiveBentoRows(candidate, minimumRows),
      item,
      effectiveBentoRows(item, minimumRows),
    ));
    while (collisions.length) {
      candidate.y = Math.max(...collisions.map((item) => item.y + effectiveBentoRows(item, minimumRows)));
      collisions = placed.filter((item) => overlaps(
        candidate,
        effectiveBentoRows(candidate, minimumRows),
        item,
        effectiveBentoRows(item, minimumRows),
      ));
    }
    placed.push(candidate);
  }
  const byId = new Map(placed.map((item) => [item.id, item]));
  return normalized.map((item) => ({ ...byId.get(item.id)! }));
}

export function moveBentoItem(
  layout: readonly BentoLayoutItem[],
  id: DashboardCardId,
  x: number,
  y: number,
  minimumRows: BentoMinimumRows = {},
): BentoLayoutItem[] {
  const moved = normalizeBentoLayout(layout).map((item) => item.id === id
    ? { ...item, x: Math.min(BENTO_COLUMNS - item.w, Math.max(0, Math.round(x))), y: Math.max(0, Math.round(y)) }
    : item);
  return resolveBentoLayout(moved, minimumRows, id);
}

export function resizeBentoItem(
  layout: readonly BentoLayoutItem[],
  id: DashboardCardId,
  width: number,
  height: number,
  minimumRows: BentoMinimumRows = {},
): BentoLayoutItem[] {
  const resized = normalizeBentoLayout(layout).map((item) => item.id === id
    ? {
        ...item,
        w: Math.min(BENTO_COLUMNS - item.x, Math.max(1, Math.round(width))),
        h: Math.max(1, Math.round(height)),
      }
    : item);
  return resolveBentoLayout(resized, minimumRows, id);
}

export function resizeBentoItemFromEdges(
  layout: readonly BentoLayoutItem[],
  id: DashboardCardId,
  direction: BentoResizeDirection,
  columnDelta: number,
  rowDelta: number,
  minimumRows: BentoMinimumRows = {},
  displayedRows: BentoMinimumRows = {},
): BentoLayoutItem[] {
  const normalized = normalizeBentoLayout(layout);
  const resized = normalized.map((item) => {
    if (item.id !== id) return item;

    const horizontalDelta = Math.round(columnDelta);
    const verticalDelta = Math.round(rowDelta);
    const minimumHeight = Math.max(1, minimumRows[id] ?? 1);
    const visibleHeight = Math.max(item.h, displayedRows[id] ?? minimumHeight);
    const right = item.x + item.w;
    const bottom = item.y + visibleHeight;
    let x = item.x;
    let y = item.y;
    let width = item.w;
    let height = visibleHeight;

    if (direction.includes('w')) {
      x = Math.min(right - 1, Math.max(0, item.x + horizontalDelta));
      width = right - x;
    } else if (direction.includes('e')) {
      width = Math.min(BENTO_COLUMNS - item.x, Math.max(1, item.w + horizontalDelta));
    }

    if (direction.includes('n')) {
      y = Math.min(bottom - minimumHeight, Math.max(0, item.y + verticalDelta));
      height = bottom - y;
    } else if (direction.includes('s')) {
      height = Math.max(minimumHeight, visibleHeight + verticalDelta);
    }

    return { ...item, x, y, w: width, h: height };
  });
  return resolveBentoLayout(resized, minimumRows, id);
}

export function bentoLayoutRows(layout: readonly BentoLayoutItem[], minimumRows: BentoMinimumRows = {}): number {
  return Math.max(0, ...layout.map((item) => item.y + effectiveBentoRows(item, minimumRows)));
}
