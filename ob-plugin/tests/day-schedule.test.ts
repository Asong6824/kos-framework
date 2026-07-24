import { describe, expect, it } from 'vitest';
import { dayScheduleSnapshot, timeToMinutes } from '../src/views/components/day-schedule';
import type { TodayScheduleEntry } from '../src/core/dashboard';
import type { TaskObject } from '../src/core/model';

function entry(title: string, times: string[]): TodayScheduleEntry {
  const task = {
    type: 'task', filePath: `32_任务/${title}.md`, created: '2026-07-22', tags: [], title,
    status: 'todo', projects: [], scheduled_for: '2026-07-22', defer_until: null, due: '2026-07-22',
    estimate_minutes: 30, energy: 'medium', work_mode: 'shallow', growth_mode: 'neutral',
    scheduled_times: times, completed: null, outputs: [], project_contributions: [], recommendation_history: [],
  } as TaskObject;
  return { task, times };
}

describe('day schedule component model', () => {
  it('converts local times to minutes', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('23:45')).toBe(1425);
  });

  it('finds the next occurrence and maps half-hour dots', () => {
    const snapshot = dayScheduleSnapshot(
      [entry('早间简报', ['07:30']), entry('双次抓取', ['09:00', '21:00'])],
      new Date(2026, 6, 22, 8, 16, 39),
    );
    expect(snapshot.time).toBe('08:16:39');
    expect(snapshot.dateLabel).toBe('2026 年 07 月 22 日 · 星期三');
    expect(snapshot.currentSlot).toBe(16);
    expect(snapshot.next).toEqual({ title: '双次抓取', time: '09:00' });
    expect([...snapshot.scheduledSlots]).toEqual([15, 18, 42]);
  });
});
