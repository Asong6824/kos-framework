import { describe, expect, it } from 'vitest';
import { goalProgressSegments } from '../src/views/components/goal-overview';

describe('goal overview component model', () => {
  it('maps Goal progress to twenty bounded segments', () => {
    expect(goalProgressSegments(null)).toBe(0);
    expect(goalProgressSegments(0)).toBe(0);
    expect(goalProgressSegments(0.33)).toBe(7);
    expect(goalProgressSegments(1)).toBe(20);
    expect(goalProgressSegments(1.4)).toBe(20);
    expect(goalProgressSegments(-0.1)).toBe(0);
  });
});
