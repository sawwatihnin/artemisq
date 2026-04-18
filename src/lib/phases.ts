import type { PolicyProfile } from './policy';

export type MissionPhase = 'launch' | 'transit' | 'lunar_flyby' | 'return';

export interface PhasePolicyParams {
  weights: { fuel: number; rad: number; comm: number; safety: number; time: number };
  thresholds: { risk: number; acute: number; abort: number };
  policyProfile: PolicyProfile;
}

export interface PhasePolicyResult {
  phase: MissionPhase;
  adjustedWeights: PhasePolicyParams['weights'];
  adjustedThresholds: PhasePolicyParams['thresholds'];
  rationale: string;
}

export function applyPhasePolicy(
  phase: MissionPhase,
  params: PhasePolicyParams,
): PhasePolicyResult {
  if (phase === 'launch') {
    return {
      phase,
      adjustedWeights: { ...params.weights, safety: params.weights.safety * 1.25, fuel: params.weights.fuel * 1.1 },
      adjustedThresholds: { ...params.thresholds, abort: params.thresholds.abort * 0.95 },
      rationale: 'Launch phase prioritizes structural and abort margins because options are time-critical and propulsion-constrained.',
    };
  }
  if (phase === 'lunar_flyby') {
    return {
      phase,
      adjustedWeights: { ...params.weights, rad: params.weights.rad * 1.2, comm: params.weights.comm * 1.08 },
      adjustedThresholds: { ...params.thresholds, acute: params.thresholds.acute * 0.92, risk: params.thresholds.risk * 0.96 },
      rationale: 'Lunar flyby policy tightens radiation and communications limits during the highest exposure geometry.',
    };
  }
  if (phase === 'return') {
    return {
      phase,
      adjustedWeights: { ...params.weights, safety: params.weights.safety * 1.18, time: params.weights.time * 1.08 },
      adjustedThresholds: { ...params.thresholds, abort: params.thresholds.abort * 0.98 },
      rationale: 'Return phase emphasizes safe corridor closure and crew recovery over marginal mission extension.',
    };
  }
  return {
    phase,
    adjustedWeights: { ...params.weights },
    adjustedThresholds: { ...params.thresholds },
    rationale: 'Transit phase preserves the baseline cruise trade among propellant, dose accumulation, and communication continuity.',
  };
}
