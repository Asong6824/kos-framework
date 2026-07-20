/**
 * components/ — 视图层可复用 SVG/DOM 组件
 *
 * 全部原生 DOM + 自绘 SVG，不引入前端框架/图表库（移动端可用）。
 * CSS class 统一 kos- 前缀，样式集中在 ob-plugin/styles.css。
 * 组件只做渲染：指标数据由调用方从 core 取好后传入。
 */

import { heatLevel } from '../../core/metrics';
import type { BadgeId, CompoundPoint } from '../../core/metrics';
import { addDays, dateRange, startOfWeek } from '../../core/snapshot';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 创建带属性的 SVG 元素 */
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// ---------------------------------------------------------------------------
// progressRing — 圆环进度（M4 等）
// ---------------------------------------------------------------------------

export interface RingOptions {
  /** 弧线色调：accent（默认）或 green（输入环等区分用） */
  tone?: 'accent' | 'green';
}

/**
 * 圆环进度。ratio 为 null 时降级：不画弧，中心显示 centerText（缺省 '—'）。
 * label 显示在圆环下方。
 */
export function progressRing(
  el: HTMLElement,
  ratio: number | null,
  label: string,
  centerText?: string,
  opts?: RingOptions,
): void {
  const wrap = el.createDiv({ cls: `kos-ring${opts?.tone === 'green' ? ' kos-ring-green' : ''}` });
  const R = 34;
  const C = 2 * Math.PI * R;
  const svg = svgEl('svg', { viewBox: '0 0 84 84', class: 'kos-ring-svg' });
  svg.appendChild(svgEl('circle', { class: 'kos-ring-track', cx: '42', cy: '42', r: String(R) }));
  if (ratio !== null) {
    const v = Math.max(0, Math.min(1, ratio));
    const arc = svgEl('circle', { class: 'kos-ring-value', cx: '42', cy: '42', r: String(R) });
    arc.style.strokeDasharray = String(C);
    arc.style.strokeDashoffset = String(C * (1 - v));
    svg.appendChild(arc);
  }
  wrap.appendChild(svg);
  wrap
    .createDiv({ cls: 'kos-ring-center' })
    .setText(ratio !== null ? `${Math.round(ratio * 100)}%` : centerText ?? '—');
  wrap.createDiv({ cls: 'kos-ring-label' }).setText(label);
}

// ---------------------------------------------------------------------------
// heatmapGrid — GitHub 风格日历热力图（M5）
// ---------------------------------------------------------------------------

export interface HeatmapOptions {
  /** 本地今天 YYYY-MM-DD */
  today: string;
  /** 展示天数（含今天），默认 365 */
  days?: number;
  /** 周起始日：0=周日 1=周一，默认 1 */
  weekStart?: number;
}

/** 日历热力图：按周列排布、五档色阶（kos-heat-0..4）、tooltip 显示日期与分值 */
export function heatmapGrid(el: HTMLElement, dayScores: Record<string, number>, opts: HeatmapOptions): void {
  const days = opts.days ?? 365;
  const weekStart = opts.weekStart ?? 1;
  const start = addDays(opts.today, -(days - 1));
  // 首列从 start 所在周的起始日开始，前面的格子留空占位
  const firstCol = startOfWeek(start, weekStart);

  const grid = el.createDiv({ cls: 'kos-heatmap' });
  for (let d = firstCol; d <= opts.today; d = addDays(d, 1)) {
    if (d < start) {
      grid.createDiv({ cls: 'kos-heat-cell kos-heat-blank' });
      continue;
    }
    const score = dayScores[d] ?? 0;
    const cell = grid.createDiv({ cls: `kos-heat-cell kos-heat-${heatLevel(score)}` });
    if (d === opts.today) cell.addClass('kos-heat-today');
    cell.title = `${d}：${score} 分`;
  }
}

// ---------------------------------------------------------------------------
// sparkline — 增长小折线
// ---------------------------------------------------------------------------

export interface SparkPoint {
  date: string;
  value: number;
}

export interface SparklineOptions {
  /** 无数据/全平时显示的 muted 空态文案（缺省只画基准线） */
  emptyText?: string;
}

/**
 * 迷你折线（M2 新增趋势等）。
 * 全 0/全平/无点时画一条基准线 + 空态文案，并返回 false（调用方可省略图注）；
 * 有真实波动时正常画线并返回 true。
 */
export function sparkline(el: HTMLElement, points: SparkPoint[], opts?: SparklineOptions): boolean {
  const W = 120;
  const H = 32;
  const PAD = 2;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'kos-sparkline', preserveAspectRatio: 'none' });
  el.appendChild(svg);

  const flat = points.length === 0 || points.every((p) => p.value === points[0].value);
  if (flat) {
    const mid = (H / 2).toFixed(1);
    svg.appendChild(svgEl('path', { d: `M${PAD},${mid} H${W - PAD}`, class: 'kos-sparkline-baseline' }));
    if (opts?.emptyText) el.createDiv({ cls: 'kos-sparkline-empty', text: opts.emptyText });
    return false;
  }

  const max = Math.max(...points.map((p) => p.value), 1);
  const step = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const d = points
    .map((p, i) => {
      const x = (PAD + i * step).toFixed(1);
      const y = (H - PAD - (p.value / max) * (H - PAD * 2)).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  svg.appendChild(svgEl('path', { d, class: 'kos-sparkline-path' }));
  return true;
}

// ---------------------------------------------------------------------------
// stackedBar — 构成堆叠条（M8 成熟度构成等）
// ---------------------------------------------------------------------------

export interface StackSegment {
  label: string;
  value: number;
  /** 缺省时用 CSS 的 kos-seg-N 循环色 */
  color?: string;
}

/** 水平构成条 + 图例；总和为 0 时显示空态 */
export function stackedBar(el: HTMLElement, segments: StackSegment[]): void {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const wrap = el.createDiv({ cls: 'kos-stackbar' });
  const track = wrap.createDiv({ cls: 'kos-stackbar-track' });
  if (total <= 0) {
    track.createDiv({ cls: 'kos-stackbar-empty', text: '暂无数据' });
  } else {
    segments.forEach((seg, i) => {
      if (seg.value <= 0) return;
      const segEl = track.createDiv({ cls: `kos-stackbar-seg kos-seg-${i}` });
      segEl.style.width = `${(seg.value / total) * 100}%`;
      if (seg.color) segEl.style.backgroundColor = seg.color;
      segEl.title = `${seg.label}：${seg.value}`;
    });
  }
  const legend = wrap.createDiv({ cls: 'kos-stackbar-legend' });
  segments.forEach((seg, i) => {
    const item = legend.createSpan({ cls: 'kos-stackbar-legend-item' });
    const dot = item.createSpan({ cls: `kos-stackbar-dot kos-seg-${i}` });
    if (seg.color) dot.style.backgroundColor = seg.color;
    item.appendText(`${seg.label} ${seg.value}`);
  });
}

// ---------------------------------------------------------------------------
// funnelChart — 漏斗（M7 输入管道）
// ---------------------------------------------------------------------------

export interface FunnelStage {
  label: string;
  count: number;
  /** 到下一级的转化率；null/undefined 显示 '—'，不传则不显示该列 */
  rate?: number | null;
}

/** 漏斗：各级条形 + 计数 + 到下一级转化率；条色按级数渐变（kos-funnel-lv-N） */
export function funnelChart(el: HTMLElement, stages: FunnelStage[]): void {
  const max = Math.max(...stages.map((s) => s.count), 1);
  const wrap = el.createDiv({ cls: 'kos-funnel' });
  stages.forEach((st, i) => {
    const row = wrap.createDiv({ cls: 'kos-funnel-row' });
    row.createSpan({ cls: 'kos-funnel-label', text: st.label });
    const barWrap = row.createDiv({ cls: 'kos-funnel-bar-wrap' });
    const bar = barWrap.createDiv({ cls: `kos-funnel-bar kos-funnel-lv-${i}` });
    bar.style.width = `${Math.max(2, (st.count / max) * 100)}%`;
    row.createSpan({ cls: 'kos-funnel-count', text: String(st.count) });
    if (st.rate !== undefined) {
      row.createSpan({ cls: 'kos-funnel-rate', text: st.rate === null ? '→ —' : `→ ${Math.round(st.rate * 100)}%` });
    }
  });
}

// ---------------------------------------------------------------------------
// compoundChart — 知识复利曲线大图（M3）
// ---------------------------------------------------------------------------

/**
 * M3 双线阶梯图：知识资产累计 + 输入源累计对照；空数据显示空态。
 * 防御：不假设入参日期连续/有序——按日期重建连续轴，缺失日沿前一累计值
 * （carry-forward），两条线共用同一阶梯序列；折线显式 fill="none"，面积用独立 path。
 */
export function compoundChart(el: HTMLElement, points: CompoundPoint[]): void {
  if (points.length === 0) {
    el.createDiv({ cls: 'kos-empty', text: '暂无数据' });
    return;
  }
  // 组件层规范化：乱序去重 → 连续日期轴 → 缺失日沿用前值
  const byDate = new Map<string, CompoundPoint>();
  for (const p of points) byDate.set(p.date, p);
  const dates = [...byDate.keys()].sort();
  const series: CompoundPoint[] = [];
  let knowledge = 0;
  let source = 0;
  for (const d of dateRange(dates[0], dates[dates.length - 1])) {
    const p = byDate.get(d);
    if (p) {
      knowledge = p.knowledge;
      source = p.source;
    }
    series.push({ date: d, knowledge, source });
  }

  const W = 640;
  const H = 180;
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_T = 14;
  const PAD_B = 20;
  const max = Math.max(...series.map((p) => Math.max(p.knowledge, p.source)), 1);
  const x = (i: number) => PAD_L + (i / Math.max(series.length - 1, 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - v / max) * (H - PAD_T - PAD_B);
  const fx = (i: number) => x(i).toFixed(1);
  const fy = (v: number) => y(v).toFixed(1);
  // 阶梯线：先水平后垂直，符合"累计值在当天内不变"的语义
  const stepPath = (vals: number[]) => {
    let d = `M${fx(0)},${fy(vals[0])}`;
    for (let i = 1; i < vals.length; i++) d += `H${fx(i)}V${fy(vals[i])}`;
    return d;
  };

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'kos-compound' });
  const knowledgeVals = series.map((p) => p.knowledge);
  // 知识线淡色面积（独立 path，stroke none；避免折线 path 依赖 CSS fill:none）
  const area = svgEl('path', {
    class: 'kos-compound-area',
    d: `${stepPath(knowledgeVals)}L${fx(series.length - 1)},${fy(0)}L${fx(0)},${fy(0)}Z`,
  });
  svg.appendChild(area);
  const srcLine = svgEl('path', { class: 'kos-compound-source', d: stepPath(series.map((p) => p.source)) });
  srcLine.setAttribute('fill', 'none');
  svg.appendChild(srcLine);
  const knLine = svgEl('path', { class: 'kos-compound-knowledge', d: stepPath(knowledgeVals) });
  knLine.setAttribute('fill', 'none');
  svg.appendChild(knLine);
  const axisLabel = (text: string, lx: number, ly: number, anchor: string) => {
    const t = svgEl('text', { class: 'kos-compound-axis', x: String(lx), y: String(ly), 'text-anchor': anchor });
    t.textContent = text;
    svg.appendChild(t);
  };
  axisLabel(series[0].date, PAD_L, H - 4, 'start');
  axisLabel(series[series.length - 1].date, W - PAD_R, H - 4, 'end');
  axisLabel(String(max), PAD_L, PAD_T - 2, 'start');
  el.appendChild(svg);

  const legend = el.createDiv({ cls: 'kos-chart-legend' });
  legend.createSpan({ cls: 'kos-chart-legend-item kos-legend-knowledge', text: '知识资产' });
  legend.createSpan({ cls: 'kos-chart-legend-item kos-legend-source', text: '输入源' });
}

// ---------------------------------------------------------------------------
// badgeNotice — 徽章解锁提示元素（M13，P4 接入触发逻辑）
// ---------------------------------------------------------------------------

/** 徽章中文名（M13 清单） */
export const BADGE_NAMES: Record<BadgeId, string> = {
  'first-concept': '首个概念',
  'concept-50': '概念半百',
  'concept-100': '概念百计',
  'first-mature': '瓜熟蒂落',
  'summary-100': '百篇摘要',
  'streak-7': '连续活跃 7 天',
  'streak-30': '连续活跃 30 天',
  'streak-100': '连续活跃 100 天',
  'diary-30': '笔耕不辍',
  'task-100': '任务百斩',
  'method-trusted': '千锤百炼',
  'method-validated-10': '实践出真知',
  'project-complete': '善始善终',
  'inbox-zero': '收件箱清零',
  'review-clear': '审核清零',
};

/** 徽章解锁提示元素；返回创建的元素（P4 负责触发与动画时机的接入） */
export function badgeNotice(el: HTMLElement, badgeId: BadgeId): HTMLElement {
  const notice = el.createDiv({ cls: 'kos-badge-notice' });
  notice.createSpan({ cls: 'kos-badge-notice-icon', text: '🏅' });
  const body = notice.createDiv({ cls: 'kos-badge-notice-body' });
  body.createDiv({ cls: 'kos-badge-notice-title', text: '徽章解锁！' });
  body.createDiv({ cls: 'kos-badge-notice-name', text: BADGE_NAMES[badgeId] });
  return notice;
}
