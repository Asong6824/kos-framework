export interface KosOnboardingSnapshot {
  mobile: boolean;
  modelConfigured: boolean;
  validationPassed: boolean;
  hasGoal: boolean;
  hasProject: boolean;
  hasTask: boolean;
  runtimePresent: boolean;
  syncPhase: string;
}

export function isKosOnboardingReady(snapshot: Readonly<KosOnboardingSnapshot>): boolean {
  return snapshot.mobile
    ? snapshot.syncPhase === 'up-to-date' && snapshot.runtimePresent
    : snapshot.modelConfigured
      && snapshot.validationPassed
      && snapshot.hasGoal
      && snapshot.hasProject
      && snapshot.hasTask;
}
