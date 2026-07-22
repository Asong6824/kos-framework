import { objectName } from '../../core/dashboard';
import type { TodayScheduleEntry } from '../../core/dashboard';

const SLOT_COUNT = 48;
const VISIBLE_TASKS = 4;

export interface DayScheduleSnapshot {
  time: string;
  currentSlot: number;
  scheduledSlots: Set<number>;
  next: { title: string; time: string } | null;
}

export interface DayScheduleHandle {
  root: HTMLElement;
  update(now?: Date): void;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function timeToMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export function dayScheduleSnapshot(entries: TodayScheduleEntry[], now: Date): DayScheduleSnapshot {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const occurrences = entries
    .flatMap((entry) => entry.times.map((time) => ({ title: objectName(entry.task), time, minutes: timeToMinutes(time) })))
    .sort((a, b) => a.minutes - b.minutes || a.title.localeCompare(b.title, 'zh-CN'));
  const next = occurrences.find((occurrence) => occurrence.minutes >= currentMinutes) ?? null;
  return {
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    currentSlot: Math.min(SLOT_COUNT - 1, Math.floor(currentMinutes / 30)),
    scheduledSlots: new Set(occurrences.map((occurrence) => Math.min(SLOT_COUNT - 1, Math.round(occurrence.minutes / 30)))),
    next: next ? { title: next.title, time: next.time } : null,
  };
}

export function renderDaySchedule(
  parent: HTMLElement,
  entries: TodayScheduleEntry[],
  initialNow = new Date(),
): DayScheduleHandle {
  const root = parent.createEl('section', {
    cls: 'kos-day-schedule',
    attr: { role: 'timer', 'aria-live': 'off' },
  });

  const head = root.createDiv({ cls: 'kos-day-schedule-head' });
  const title = head.createDiv({ cls: 'kos-day-schedule-title' });
  title.createSpan({ text: 'SCHEDULE' });
  title.createSpan({ cls: 'kos-day-schedule-separator', text: '·' });
  title.createSpan({ text: '任务时刻' });
  head.createSpan({ cls: 'kos-day-schedule-badge', text: 'LIVE' });

  const hero = root.createDiv({ cls: 'kos-day-schedule-hero' });
  const time = hero.createSpan({ cls: 'kos-day-schedule-time' });
  const next = hero.createSpan({ cls: 'kos-day-schedule-next' });

  const scale = root.createDiv({ cls: 'kos-day-schedule-scale', attr: { 'aria-hidden': 'true' } });
  scale.createSpan({ text: '00:00' });
  scale.createSpan({ text: '12:00' });
  scale.createSpan({ text: '24:00' });
  const rail = root.createDiv({ cls: 'kos-day-schedule-rail', attr: { 'aria-hidden': 'true' } });
  const slots = Array.from({ length: SLOT_COUNT }, () => rail.createSpan());

  const list = root.createDiv({ cls: 'kos-day-schedule-list' });
  for (const entry of entries.slice(0, VISIBLE_TASKS)) {
    const row = list.createDiv({ cls: 'kos-day-schedule-row' });
    const taskTitle = objectName(entry.task);
    row.createSpan({ cls: 'kos-day-schedule-task', text: taskTitle, attr: { title: taskTitle } });
    row.createSpan({ cls: 'kos-day-schedule-task-times', text: entry.times.join(' / ') });
  }
  if (entries.length === 0) list.createDiv({ cls: 'kos-day-schedule-empty', text: '今日暂无定时任务' });
  if (entries.length > VISIBLE_TASKS) {
    list.createDiv({ cls: 'kos-day-schedule-more', text: `+${entries.length - VISIBLE_TASKS} MORE` });
  }

  const footer = root.createDiv({ cls: 'kos-day-schedule-footer' });
  footer.createSpan({ text: `NT-SD · A${entries.length}` });
  footer.createSpan({ text: '48 DOTS = 30MIN/DOT' });

  const update = (now = new Date()): void => {
    const snapshot = dayScheduleSnapshot(entries, now);
    time.textContent = snapshot.time;
    next.textContent = snapshot.next ? `UNTIL · ${snapshot.next.title} · ${snapshot.next.time}` : 'UNTIL · DAY COMPLETE';
    slots.forEach((slot, index) => {
      slot.classList.toggle('is-past', index < snapshot.currentSlot);
      slot.classList.toggle('is-current', index === snapshot.currentSlot);
      slot.classList.toggle('is-scheduled', snapshot.scheduledSlots.has(index));
    });
    root.dataset.updatedAt = String(now.getTime());
    root.setAttribute('aria-label', `${snapshot.time}，${snapshot.next ? `下一任务 ${snapshot.next.title} ${snapshot.next.time}` : '今日已无后续定时任务'}`);
  };

  update(initialNow);
  return { root, update };
}
