import { describe, expect, it } from 'vitest';
import { isKosOnboardingReady } from '../src/onboarding-state';
import type { KosOnboardingSnapshot } from '../src/onboarding-state';

function snapshot(overrides: Partial<KosOnboardingSnapshot> = {}): KosOnboardingSnapshot {
  return {
    mobile: false,
    modelConfigured: true,
    validationPassed: true,
    hasGoal: true,
    hasProject: true,
    hasTask: true,
    runtimePresent: false,
    syncPhase: 'disabled',
    ...overrides,
  };
}

describe('kos first-use readiness', () => {
  it('requires the desktop model, validation, Goal, Project and Task', () => {
    expect(isKosOnboardingReady(snapshot())).toBe(true);
    expect(isKosOnboardingReady(snapshot({ hasTask: false }))).toBe(false);
    expect(isKosOnboardingReady(snapshot({ validationPassed: false }))).toBe(false);
  });

  it('requires completed sync and runtime content on mobile', () => {
    expect(isKosOnboardingReady(snapshot({ mobile: true, syncPhase: 'up-to-date', runtimePresent: true }))).toBe(true);
    expect(isKosOnboardingReady(snapshot({ mobile: true, syncPhase: 'syncing', runtimePresent: true }))).toBe(false);
    expect(isKosOnboardingReady(snapshot({ mobile: true, syncPhase: 'up-to-date', runtimePresent: false }))).toBe(false);
  });
});
