import type { PolicyProfile } from './policy';

export interface PolicySwitchState {
  currentPolicy: PolicyProfile;
  crewRisk: number;
  posteriorRisk?: number;
  anomalySeverity?: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | null;
  costPressure?: number;
  uncertaintyVariance?: number;
}

export interface PolicySwitchResult {
  newPolicy: PolicyProfile;
  reason: string;
}

export function switchPolicy(currentPolicy: PolicyProfile, desiredPolicy: PolicyProfile): PolicySwitchResult {
  return {
    newPolicy: desiredPolicy,
    reason: desiredPolicy === currentPolicy
      ? 'Current policy remains appropriate for the observed operating state.'
      : `Switch from ${currentPolicy.toLowerCase()} to ${desiredPolicy.toLowerCase()} because the mission state crossed the relevant policy threshold.`,
  };
}

export function evaluatePolicySwitch(state: PolicySwitchState): PolicySwitchResult {
  const effectiveRisk = Math.max(state.crewRisk, state.posteriorRisk ?? 0);
  if (state.anomalySeverity === 'CRITICAL' || effectiveRisk > 1.0) {
    return switchPolicy(state.currentPolicy, 'CREW_FIRST');
  }
  if ((state.costPressure ?? 0) > 0.8 && effectiveRisk < 0.55 && (state.uncertaintyVariance ?? 0) < 0.08) {
    return switchPolicy(state.currentPolicy, 'COST_FIRST');
  }
  return switchPolicy(state.currentPolicy, 'BALANCED');
}
