import { heatLevel } from '../../core/metrics';
import { addDays, daysBetween, startOfWeek } from '../../core/snapshot';

const DAYS = 365;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

export interface HeatmapDay {
  date: string;
  score: number;
  level: 0 | 1 | 2 | 3 | 4;
  blank: boolean;
}

export interface HeatmapModel {
  start: string;
  end: string;
  firstColumn: string;
  total: number;
  days: HeatmapDay[];
  months: Array<{ label: string; column: number }>;
}

function monthIndex(date: string): number {
  return Number(date.slice(5, 7)) - 1;
}

function displayDate(date: string): string {
  return `${date.slice(0, 4)}.${date.slice(5, 7)}.${date.slice(8, 10)}`;
}

export function activityHeatmapModel(
  scores: Record<string, number>,
  today: string,
  weekStart = 1,
): HeatmapModel {
  const start = addDays(today, -(DAYS - 1));
  const firstColumn = startOfWeek(start, weekStart);
  const days: HeatmapDay[] = [];
  const months: Array<{ label: string; column: number }> = [];
  const seenMonths = new Set<string>();
  const partialStartMonth = Number(start.slice(8, 10)) > 7 ? start.slice(0, 7) : null;
  let total = 0;

  for (let date = firstColumn; date <= today; date = addDays(date, 1)) {
    const blank = date < start;
    const score = blank ? 0 : Math.max(0, scores[date] ?? 0);
    if (!blank) total += score;
    days.push({ date, score, level: heatLevel(score), blank });
    const key = date.slice(0, 7);
    if (!blank && key !== partialStartMonth && !seenMonths.has(key)) {
      seenMonths.add(key);
      months.push({ label: MONTHS[monthIndex(date)], column: Math.floor(daysBetween(firstColumn, date) / 7) + 1 });
    }
  }
  return { start, end: today, firstColumn, total, days, months };
}

export function renderActivityHeatmap(
  parent: HTMLElement,
  scores: Record<string, number>,
  today: string,
  weekStart = 1,
): HTMLElement {
  const model = activityHeatmapModel(scores, today, weekStart);
  const root = parent.createEl('section', {
    cls: 'kos-activity-heatmap',
    attr: { 'aria-label': `活动热力图，${model.start} 至 ${model.end}，累计 ${model.total} 分` },
  });

  const head = root.createDiv({ cls: 'kos-activity-heatmap-head' });
  const title = head.createDiv({ cls: 'kos-activity-heatmap-title' });
  title.createSpan({ text: 'HEATMAP' });
  title.createSpan({ cls: 'kos-activity-heatmap-separator', text: '·' });
  title.createSpan({ text: '热点图' });
  head.createSpan({ cls: 'kos-activity-heatmap-badge', text: 'M5 · LIVE DATA' });

  const body = root.createDiv({ cls: 'kos-activity-heatmap-body' });
  const summary = body.createDiv({ cls: 'kos-activity-heatmap-summary' });
  summary.createDiv({ cls: 'kos-activity-heatmap-total', text: String(model.total) });
  summary.createDiv({ cls: 'kos-activity-heatmap-contributions', text: 'CONTRIBUTIONS' });
  summary.createDiv({ cls: 'kos-activity-heatmap-range', text: `${displayDate(model.start)} — ${displayDate(model.end)}` });
  const legend = summary.createDiv({ cls: 'kos-activity-heatmap-legend', attr: { 'aria-hidden': 'true' } });
  legend.createSpan({ cls: 'kos-activity-heatmap-legend-label', text: 'LESS' });
  for (let level = 0; level <= 4; level += 1) legend.createSpan({ cls: `kos-activity-heatmap-cell kos-heat-${level}` });
  legend.createSpan({ cls: 'kos-activity-heatmap-legend-label', text: 'MORE' });

  const chart = body.createDiv({ cls: 'kos-activity-heatmap-chart' });
  const months = chart.createDiv({ cls: 'kos-activity-heatmap-months', attr: { 'aria-hidden': 'true' } });
  months.style.setProperty('--kos-heatmap-columns', String(Math.ceil(model.days.length / 7)));
  for (const month of model.months) {
    const label = months.createSpan({ text: month.label });
    label.style.gridColumn = String(month.column);
  }
  const weekdayLabels = chart.createDiv({ cls: 'kos-activity-heatmap-weekdays', attr: { 'aria-hidden': 'true' } });
  weekdayLabels.createSpan({ text: 'MON' });
  weekdayLabels.createSpan({ text: 'WED' });
  weekdayLabels.createSpan({ text: 'FRI' });
  const grid = chart.createDiv({ cls: 'kos-activity-heatmap-grid' });
  grid.style.setProperty('--kos-heatmap-columns', String(Math.ceil(model.days.length / 7)));
  for (const day of model.days) {
    if (day.blank) {
      grid.createSpan({ cls: 'kos-activity-heatmap-cell is-blank', attr: { 'aria-hidden': 'true' } });
      continue;
    }
    const cell = grid.createSpan({ cls: `kos-activity-heatmap-cell kos-heat-${day.level}` });
    if (day.date === today) cell.addClass('is-today');
    cell.title = `${day.date} · ${day.score} 分`;
  }

  const footer = root.createDiv({ cls: 'kos-activity-heatmap-footer' });
  footer.createSpan({ text: 'NT-HM · M5' });
  footer.createSpan({ text: 'DETERMINISTIC · 365 DAYS' });
  return root;
}
