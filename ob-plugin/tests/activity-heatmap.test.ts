import { describe, expect, it } from 'vitest';
import { activityHeatmapModel } from '../src/views/components/activity-heatmap';

describe('dashboard activity heatmap model', () => {
  it('builds 365 real days with leading week blanks and month labels', () => {
    const model = activityHeatmapModel({ '2026-07-22': 4, '2025-07-23': 2 }, '2026-07-22', 1);
    expect(model.start).toBe('2025-07-23');
    expect(model.end).toBe('2026-07-22');
    expect(model.firstColumn).toBe('2025-07-21');
    expect(model.days.filter((day) => !day.blank)).toHaveLength(365);
    expect(model.total).toBe(6);
    expect(model.days[model.days.length - 1]).toMatchObject({ date: '2026-07-22', score: 4, level: 2 });
    expect(model.months[0]).toMatchObject({ label: 'AUG', column: 2 });
    expect(model.months[model.months.length - 1]?.label).toBe('JUL');
  });
});
