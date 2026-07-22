import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragMoveEvent, DragStartEvent, KeyboardCoordinateGetter } from '@dnd-kit/core';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { setIcon } from 'obsidian';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  BENTO_COLUMNS,
  BENTO_GAP,
  BENTO_ROW_HEIGHT,
  bentoLayoutRows,
  cloneBentoLayout,
  DEFAULT_BENTO_LAYOUT,
  DASHBOARD_MODULE_IDS,
  effectiveBentoRows,
  moveBentoItem,
  normalizeBentoLayout,
  resizeBentoItemFromEdges,
  resolveBentoLayout,
  UTILITY_MINIMUM_ROWS,
} from '../../core/bento-layout';
import type {
  BentoLayoutItem,
  BentoMinimumRows,
  BentoResizeDirection,
  DashboardCardId,
  DashboardWidgetId,
} from '../../core/bento-layout';
import { expandedBentoRows } from '../../core/dashboard';
import type { DashboardModule } from '../../core/dashboard';

const MODULE_LABELS: Record<DashboardModule, string> = {
  today: '今日',
  action: '行动',
  input: '输入',
  knowledge: '知识',
  review: '审阅与复盘',
  system: '系统',
};

const WIDGET_LABELS: Record<DashboardWidgetId, string> = {
  clock: '时钟',
  schedule: '任务时刻',
  progress: '年度进度',
  heatmap: '热点图',
};

const CARD_LABELS: Record<DashboardCardId, string> = { ...WIDGET_LABELS, ...MODULE_LABELS };

function isDashboardWidgetId(id: DashboardCardId): id is DashboardWidgetId {
  return id === 'clock' || id === 'schedule' || id === 'progress' || id === 'heatmap';
}

const DEFAULT_BANDS: DashboardModule[][] = [
  ['today', 'knowledge'],
  ['action', 'input'],
  ['review', 'system'],
];

const RESIZE_DIRECTIONS: BentoResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const RESIZE_LABELS: Record<BentoResizeDirection, string> = {
  n: '上边',
  s: '下边',
  e: '右边',
  w: '左边',
  ne: '右上角',
  nw: '左上角',
  se: '右下角',
  sw: '左下角',
};

interface IconProps {
  name: string;
}

function Icon({ name }: IconProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span ref={ref} aria-hidden="true" />;
}

interface ToolbarButtonProps {
  label: string;
  icon: string;
  disabled?: boolean;
  text?: string;
  active?: boolean;
  onClick(): void;
}

function ToolbarButton({ label, icon, disabled, text, active, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`kos-bento-toolbar-button${active ? ' is-active' : ''}${text ? ' has-text' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
      {text ? <span>{text}</span> : null}
    </button>
  );
}

function defaultPresentationMinimums(layout: readonly BentoLayoutItem[], measured: BentoMinimumRows): BentoMinimumRows {
  const result = { ...UTILITY_MINIMUM_ROWS, ...measured };
  const businessIsDefault = DASHBOARD_MODULE_IDS.every((id) => {
    const item = layout.find((candidate) => candidate.id === id);
    const expected = DEFAULT_BENTO_LAYOUT.find((candidate) => candidate.id === id);
    return item && expected && item.x === expected.x && item.y === expected.y && item.w === expected.w && item.h === expected.h;
  });
  if (!businessIsDefault) return result;
  for (const band of DEFAULT_BANDS) {
    const rows = Math.max(...band.map((id) => result[id] ?? 1));
    for (const id of band) result[id] = rows;
  }
  return result;
}

function sameLayout(a: readonly BentoLayoutItem[], b: readonly BentoLayoutItem[]): boolean {
  return JSON.stringify(normalizeBentoLayout(a)) === JSON.stringify(normalizeBentoLayout(b));
}

interface ContentHostProps {
  module: DashboardModule;
  renderVersion: number;
  renderModule(module: DashboardModule, host: HTMLElement): void;
  onMeasure(module: DashboardModule, rows: number): void;
}

function ContentHost({ module, renderVersion, renderModule, onMeasure }: ContentHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.empty();
    renderModule(module, host);
  }, [module, renderModule, renderVersion]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const section = host?.closest<HTMLElement>('.kos-board-section');
    if (!host || !section) return;
    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const styles = window.getComputedStyle(section);
        const padding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
        onMeasure(module, expandedBentoRows(host.scrollHeight + padding, BENTO_ROW_HEIGHT, BENTO_GAP, 1));
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [module, onMeasure, renderVersion]);

  return <div ref={hostRef} className="kos-board-section-content" />;
}

interface UtilityCardProps {
  item: BentoLayoutItem;
  effectiveRows: number;
  editing: boolean;
  dragging: boolean;
  resizing: boolean;
  resizeDirection: BentoResizeDirection | null;
  reduceMotion: boolean;
  renderVersion: number;
  mount(host: HTMLElement): void;
  onResizeStart(id: DashboardCardId, direction: BentoResizeDirection, event: ReactPointerEvent<HTMLButtonElement>): void;
}

function UtilityCard({ item, effectiveRows, editing, dragging, resizing, resizeDirection, reduceMotion, renderVersion, mount, onResizeStart }: UtilityCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = item.id as DashboardWidgetId;
  const { attributes, listeners, setNodeRef } = useDraggable({ id, disabled: !editing });
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.empty();
    mount(ref.current);
  }, [mount, renderVersion]);
  const style = {
    '--kos-bento-columns': item.w,
    '--kos-bento-rows': effectiveRows,
    gridColumn: `${item.x + 1} / span ${item.w}`,
    gridRow: `${item.y + 1} / span ${effectiveRows}`,
  } as CSSProperties;
  return (
    <motion.div
      ref={setNodeRef}
      layout="position"
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42, mass: 0.7 }}
      className={`kos-board-utility-card is-${id}${editing ? ' is-layout-editing' : ''}${dragging ? ' is-layout-active' : ''}${resizing ? ' is-layout-resizing' : ''}`}
      data-widget={id}
      data-bento={`${item.w}x${item.h}`}
      data-bento-columns={item.w}
      data-bento-min-rows={item.h}
      data-bento-effective={`${item.w}x${effectiveRows}`}
      data-bento-x={item.x}
      data-bento-y={item.y}
      data-resize-direction={resizing ? resizeDirection ?? undefined : undefined}
      style={style}
    >
      <div ref={ref} className={`kos-board-${id}-host`} />
      <AnimatePresence>
        {editing ? (
          <motion.div
            className="kos-bento-card-controls"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.14 }}
          >
            <button
              type="button"
              className="kos-bento-drag-handle"
              aria-label={`移动${WIDGET_LABELS[id]}`}
              title={`移动${WIDGET_LABELS[id]}`}
              {...attributes}
              {...listeners}
            >
              <Icon name="grip-horizontal" />
              <span className="kos-bento-size-label">{item.w}×{effectiveRows}</span>
            </button>
            {RESIZE_DIRECTIONS.map((direction) => (
              <button
                key={direction}
                type="button"
                className={`kos-bento-resize-zone is-${direction}`}
                data-resize-direction={direction}
                aria-label={`从${RESIZE_LABELS[direction]}调整${WIDGET_LABELS[id]}大小`}
                title={`拖动${RESIZE_LABELS[direction]}调整大小`}
                onPointerDown={(event) => onResizeStart(id, direction, event)}
              />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

interface BentoCardProps {
  item: BentoLayoutItem & { id: DashboardModule };
  effectiveRows: number;
  editing: boolean;
  dragging: boolean;
  resizing: boolean;
  resizeDirection: BentoResizeDirection | null;
  reduceMotion: boolean;
  renderVersion: number;
  renderModule(module: DashboardModule, host: HTMLElement): void;
  onMeasure(module: DashboardModule, rows: number): void;
  onResizeStart(id: DashboardCardId, direction: BentoResizeDirection, event: ReactPointerEvent<HTMLButtonElement>): void;
}

function BentoCard({
  item,
  effectiveRows,
  editing,
  dragging,
  resizing,
  resizeDirection,
  reduceMotion,
  renderVersion,
  renderModule,
  onMeasure,
  onResizeStart,
}: BentoCardProps) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: item.id, disabled: !editing });
  const style = {
    '--kos-bento-columns': item.w,
    '--kos-bento-rows': effectiveRows,
    gridColumn: `${item.x + 1} / span ${item.w}`,
    gridRow: `${item.y + 1} / span ${effectiveRows}`,
  } as CSSProperties;
  return (
    <motion.section
      ref={setNodeRef}
      layout="position"
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42, mass: 0.7 }}
      className={`kos-board-section kos-board-${item.id}${editing ? ' is-layout-editing' : ''}${dragging ? ' is-layout-active' : ''}${resizing ? ' is-layout-resizing' : ''}`}
      id={`kos-board-${item.id}`}
      data-bento={`${item.w}x${item.h}`}
      data-bento-columns={item.w}
      data-bento-min-rows={item.h}
      data-bento-effective={`${item.w}x${effectiveRows}`}
      data-bento-x={item.x}
      data-bento-y={item.y}
      data-resize-direction={resizing ? resizeDirection ?? undefined : undefined}
      style={style}
    >
      <ContentHost
        module={item.id}
        renderVersion={renderVersion}
        renderModule={renderModule}
        onMeasure={onMeasure}
      />
      <AnimatePresence>
        {editing ? (
          <motion.div
            className="kos-bento-card-controls"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.14 }}
          >
            <button
              type="button"
              className="kos-bento-drag-handle"
              aria-label={`移动${MODULE_LABELS[item.id]}`}
              title={`移动${MODULE_LABELS[item.id]}`}
              {...attributes}
              {...listeners}
            >
              <Icon name="grip-horizontal" />
              <span className="kos-bento-size-label">{item.w}×{effectiveRows}</span>
            </button>
            {RESIZE_DIRECTIONS.map((direction) => (
              <button
                key={direction}
                type="button"
                className={`kos-bento-resize-zone is-${direction}`}
                data-resize-direction={direction}
                aria-label={`从${RESIZE_LABELS[direction]}调整${MODULE_LABELS[item.id]}大小`}
                title={`拖动${RESIZE_LABELS[direction]}调整大小`}
                onPointerDown={(event) => onResizeStart(item.id, direction, event)}
              />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}

interface DashboardAppProps {
  initialLayout: BentoLayoutItem[];
  renderVersion: number;
  renderModule(module: DashboardModule, host: HTMLElement): void;
  mountClock(host: HTMLElement): void;
  mountSchedule(host: HTMLElement): void;
  mountProgress(host: HTMLElement): void;
  mountHeatmap(host: HTMLElement): void;
  persistDashboard(layout: BentoLayoutItem[]): Promise<void>;
}

export function DashboardApp({
  initialLayout,
  renderVersion,
  renderModule,
  mountClock,
  mountSchedule,
  mountProgress,
  mountHeatmap,
  persistDashboard,
}: DashboardAppProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const gridRef = useRef<HTMLDivElement>(null);
  const keyboardCoordinates = useCallback<KeyboardCoordinateGetter>((event, { currentCoordinates }) => {
    const width = gridRef.current?.getBoundingClientRect().width ?? 0;
    const horizontal = width > 0 ? (width - BENTO_GAP * (BENTO_COLUMNS - 1)) / BENTO_COLUMNS + BENTO_GAP : 1;
    const vertical = BENTO_ROW_HEIGHT + BENTO_GAP;
    if (event.code === 'ArrowRight') return { ...currentCoordinates, x: currentCoordinates.x + horizontal };
    if (event.code === 'ArrowLeft') return { ...currentCoordinates, x: currentCoordinates.x - horizontal };
    if (event.code === 'ArrowDown') return { ...currentCoordinates, y: currentCoordinates.y + vertical };
    if (event.code === 'ArrowUp') return { ...currentCoordinates, y: currentCoordinates.y - vertical };
    return undefined;
  }, []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );
  const [layout, setLayout] = useState(() => normalizeBentoLayout(initialLayout));
  const [preview, setPreviewState] = useState<BentoLayoutItem[] | null>(null);
  const [minimumRows, setMinimumRows] = useState<BentoMinimumRows>({ ...UTILITY_MINIMUM_ROWS });
  const [editing, setEditing] = useState(false);
  const [activeId, setActiveId] = useState<DashboardCardId | null>(null);
  const [interaction, setInteraction] = useState<'drag' | 'resize' | null>(null);
  const [resizeDirection, setResizeDirection] = useState<BentoResizeDirection | null>(null);
  const [past, setPast] = useState<BentoLayoutItem[][]>([]);
  const [future, setFuture] = useState<BentoLayoutItem[][]>([]);
  const previewRef = useRef<BentoLayoutItem[] | null>(null);
  const dragBaseRef = useRef<BentoLayoutItem[] | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const setPreview = useCallback((next: BentoLayoutItem[] | null) => {
    previewRef.current = next;
    setPreviewState(next);
  }, []);

  const presentationMinimums = useMemo(
    () => defaultPresentationMinimums(preview ?? layout, minimumRows),
    [layout, minimumRows, preview],
  );
  const displayedLayout = useMemo(
    () => resolveBentoLayout(preview ?? layout, presentationMinimums, activeId ?? undefined),
    [activeId, layout, presentationMinimums, preview],
  );

  const persist = useCallback((nextLayout: BentoLayoutItem[]) => {
    void persistDashboard(cloneBentoLayout(nextLayout));
  }, [persistDashboard]);

  const commitLayout = useCallback((nextLayout: BentoLayoutItem[]) => {
    const normalizedLayout = normalizeBentoLayout(nextLayout);
    const currentLayout = layoutRef.current;
    if (sameLayout(currentLayout, normalizedLayout)) return;
    setPast((items) => [...items.slice(-19), cloneBentoLayout(currentLayout)]);
    setFuture([]);
    setLayout(normalizedLayout);
    layoutRef.current = normalizedLayout;
    persist(normalizedLayout);
  }, [persist]);

  const onMeasure = useCallback((module: DashboardModule, rows: number) => {
    setMinimumRows((current) => current[module] === rows ? current : { ...current, [module]: rows });
  }, []);

  const gridUnits = useCallback(() => {
    const width = gridRef.current?.getBoundingClientRect().width ?? 0;
    return {
      x: width > 0 ? (width - BENTO_GAP * (BENTO_COLUMNS - 1)) / BENTO_COLUMNS + BENTO_GAP : 1,
      y: BENTO_ROW_HEIGHT + BENTO_GAP,
    };
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = event.active.id as DashboardCardId;
    dragBaseRef.current = cloneBentoLayout(layoutRef.current);
    setPreview(dragBaseRef.current);
    setActiveId(id);
    setInteraction('drag');
  }, [setPreview]);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const id = event.active.id as DashboardCardId;
    const base = dragBaseRef.current;
    const item = base?.find((candidate) => candidate.id === id);
    if (!base || !item) return;
    const units = gridUnits();
    setPreview(moveBentoItem(
      base,
      id,
      item.x + event.delta.x / units.x,
      item.y + event.delta.y / units.y,
      defaultPresentationMinimums(base, minimumRows),
    ));
  }, [gridUnits, minimumRows, setPreview]);

  const finishInteraction = useCallback((commitPreview: boolean) => {
    const next = previewRef.current;
    setPreview(null);
    setActiveId(null);
    setInteraction(null);
    setResizeDirection(null);
    dragBaseRef.current = null;
    if (commitPreview && next) commitLayout(next);
  }, [commitLayout, setPreview]);

  const handleDragEnd = useCallback((_event: DragEndEvent) => finishInteraction(true), [finishInteraction]);

  const handleResizeStart = useCallback((id: DashboardCardId, direction: BentoResizeDirection, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const base = cloneBentoLayout(displayedLayout);
    const item = base.find((candidate) => candidate.id === id);
    if (!item) return;
    const units = gridUnits();
    const effectiveRows = Object.fromEntries(base.map((candidate) => [
      candidate.id,
      candidate.id === id ? effectiveBentoRows(candidate, presentationMinimums) : candidate.h,
    ])) as BentoMinimumRows;
    dragBaseRef.current = base;
    setPreview(base);
    setActiveId(id);
    setInteraction('resize');
    setResizeDirection(direction);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const move = (pointer: PointerEvent) => {
      setPreview(resizeBentoItemFromEdges(
        base,
        id,
        direction,
        (pointer.clientX - startX) / units.x,
        (pointer.clientY - startY) / units.y,
        presentationMinimums,
        effectiveRows,
      ));
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      finishInteraction(true);
    };
    const cancel = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      finishInteraction(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
  }, [displayedLayout, finishInteraction, gridUnits, presentationMinimums, setPreview]);

  const undo = useCallback(() => {
    const previous = past[past.length - 1];
    if (!previous) return;
    const current = cloneBentoLayout(layoutRef.current);
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [current, ...items].slice(0, 20));
    setLayout(previous);
    layoutRef.current = previous;
    persist(previous);
  }, [past, persist]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    const current = cloneBentoLayout(layoutRef.current);
    setFuture((items) => items.slice(1));
    setPast((items) => [...items.slice(-19), current]);
    setLayout(next);
    layoutRef.current = next;
    persist(next);
  }, [future, persist]);

  const toggleEditing = useCallback(() => {
    setPreview(null);
    setActiveId(null);
    setInteraction(null);
    setResizeDirection(null);
    setEditing((value) => !value);
  }, [setPreview]);

  const activeItem = activeId ? displayedLayout.find((item) => item.id === activeId) : undefined;
  const fitted = DASHBOARD_MODULE_IDS.every((id) => minimumRows[id] !== undefined);
  const guideRows = bentoLayoutRows(displayedLayout, presentationMinimums);
  const utilityMounts: Record<DashboardWidgetId, (host: HTMLElement) => void> = {
    clock: mountClock,
    schedule: mountSchedule,
    progress: mountProgress,
    heatmap: mountHeatmap,
  };

  return (
    <main className="kos-board-canvas">
      <motion.div className="kos-bento-toolbar" layout transition={{ duration: reduceMotion ? 0 : 0.16 }}>
        <ToolbarButton
          label={editing ? '完成布局编辑' : '编辑看板布局'}
          icon={editing ? 'check' : 'panels-top-left'}
          text={editing ? '完成' : '编辑布局'}
          active={editing}
          onClick={toggleEditing}
        />
        <AnimatePresence initial={false}>
          {editing ? (
            <motion.div
              className="kos-bento-toolbar-actions"
              initial={reduceMotion ? false : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
            >
              <ToolbarButton label="撤销布局调整" icon="undo-2" disabled={!past.length} onClick={undo} />
              <ToolbarButton label="重做布局调整" icon="redo-2" disabled={!future.length} onClick={redo} />
              <ToolbarButton label="恢复默认布局" icon="rotate-ccw" onClick={() => commitLayout(DEFAULT_BENTO_LAYOUT)} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={() => finishInteraction(false)}
      >
        <div className="kos-bento-stage">
          <AnimatePresence>
            {editing ? (
              <motion.div
                className="kos-bento-grid-guide"
                aria-hidden="true"
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.16 }}
              >
                {Array.from({ length: guideRows * BENTO_COLUMNS }, (_, index) => <span key={index} />)}
              </motion.div>
            ) : null}
          </AnimatePresence>
          <motion.div
            ref={gridRef}
            className={`kos-board-grid${editing ? ' is-layout-editing' : ''}`}
            data-bento-fitted={fitted ? 'true' : undefined}
            data-bento-editing={editing ? 'true' : 'false'}
          >
            {displayedLayout.map((item) => isDashboardWidgetId(item.id) ? (
              <UtilityCard
                key={item.id}
                item={item}
                effectiveRows={effectiveBentoRows(item, presentationMinimums)}
                editing={editing}
                dragging={interaction === 'drag' && activeId === item.id}
                resizing={interaction === 'resize' && activeId === item.id}
                resizeDirection={interaction === 'resize' && activeId === item.id ? resizeDirection : null}
                reduceMotion={reduceMotion}
                renderVersion={renderVersion}
                mount={utilityMounts[item.id]}
                onResizeStart={handleResizeStart}
              />
            ) : (
              <BentoCard
                key={item.id}
                item={item as BentoLayoutItem & { id: DashboardModule }}
                effectiveRows={effectiveBentoRows(item, presentationMinimums)}
                editing={editing}
                dragging={interaction === 'drag' && activeId === item.id}
                resizing={interaction === 'resize' && activeId === item.id}
                resizeDirection={interaction === 'resize' && activeId === item.id ? resizeDirection : null}
                reduceMotion={reduceMotion}
                renderVersion={renderVersion}
                renderModule={renderModule}
                onMeasure={onMeasure}
                onResizeStart={handleResizeStart}
              />
            ))}
          </motion.div>
        </div>
        <DragOverlay dropAnimation={reduceMotion ? null : { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
          {interaction === 'drag' && activeItem ? (
            <div className="kos-bento-drag-overlay">
              <span>{CARD_LABELS[activeItem.id]}</span>
              <strong>{activeItem.w}×{effectiveBentoRows(activeItem, presentationMinimums)}</strong>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </main>
  );
}
