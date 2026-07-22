const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

export interface ClockSnapshot {
  hours: string;
  minutes: string;
  seconds: string;
  dateLabel: string;
  week: number;
  dayOfYear: number;
  daysInYear: number;
}

export interface DotClockHandle {
  root: HTMLElement;
  update(now?: Date): void;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoWeek(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

export function clockSnapshot(now: Date): ClockSnapshot {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const start = Date.UTC(year, 0, 1);
  const current = Date.UTC(year, month, day);
  const nextYear = Date.UTC(year + 1, 0, 1);
  return {
    hours: pad(now.getHours()),
    minutes: pad(now.getMinutes()),
    seconds: pad(now.getSeconds()),
    dateLabel: `${year} 年 ${pad(month + 1)} 月 ${pad(day)} 日 · 星期${WEEKDAYS[now.getDay()]}`,
    week: isoWeek(now),
    dayOfYear: Math.floor((current - start) / 86_400_000) + 1,
    daysInYear: Math.round((nextYear - start) / 86_400_000),
  };
}

export function renderDotClock(parent: HTMLElement, initialNow = new Date()): DotClockHandle {
  const root = parent.createEl('section', {
    cls: 'kos-dot-clock',
    attr: { role: 'timer', 'aria-live': 'off' },
  });
  const eyebrow = root.createDiv({ cls: 'kos-dot-clock-eyebrow' });
  eyebrow.createSpan({ text: 'CLOCK' });
  eyebrow.createSpan({ cls: 'kos-dot-clock-separator', text: '·' });
  eyebrow.createSpan({ text: 'LOCAL' });

  const display = root.createDiv({ cls: 'kos-dot-clock-display' });
  const time = display.createSpan({ cls: 'kos-dot-clock-time' });
  const seconds = display.createSpan({ cls: 'kos-dot-clock-seconds' });
  const date = root.createDiv({ cls: 'kos-dot-clock-date' });

  const footer = root.createDiv({ cls: 'kos-dot-clock-footer' });
  const week = footer.createSpan({ cls: 'kos-dot-clock-stat' });
  week.createSpan({ cls: 'kos-dot-clock-label', text: 'WEEK' });
  const weekValue = week.createSpan({ cls: 'kos-dot-clock-value' });
  footer.createSpan({ cls: 'kos-dot-clock-separator', text: '·' });
  const yearDay = footer.createSpan({ cls: 'kos-dot-clock-stat' });
  yearDay.createSpan({ cls: 'kos-dot-clock-label', text: 'DAY' });
  const dayValue = yearDay.createSpan({ cls: 'kos-dot-clock-value' });
  yearDay.createSpan({ cls: 'kos-dot-clock-divider', text: '/' });
  const daysValue = yearDay.createSpan({ cls: 'kos-dot-clock-value' });
  footer.createSpan({ cls: 'kos-dot-clock-separator', text: '·' });
  const pulse = footer.createSpan({ cls: 'kos-dot-clock-pulse', attr: { 'aria-hidden': 'true' } });
  footer.createSpan({ cls: 'kos-dot-clock-label', text: 'SEC' });

  const update = (now = new Date()): void => {
    const snapshot = clockSnapshot(now);
    time.textContent = `${snapshot.hours}:${snapshot.minutes}`;
    seconds.textContent = snapshot.seconds;
    date.textContent = snapshot.dateLabel;
    weekValue.textContent = String(snapshot.week);
    dayValue.textContent = String(snapshot.dayOfYear);
    daysValue.textContent = String(snapshot.daysInYear);
    pulse.classList.toggle('is-tick', Number(snapshot.seconds) % 2 === 0);
    root.setAttribute('aria-label', `${snapshot.dateLabel} ${snapshot.hours}:${snapshot.minutes}:${snapshot.seconds}`);
  };

  update(initialNow);
  return { root, update };
}
