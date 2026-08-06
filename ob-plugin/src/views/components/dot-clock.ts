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
