import type { CrewRadiationParams } from './crewRisk';
import type { MissionDecisionParams } from './missionDecision';
import type { QUBOWeights } from './optimizer';

export type PolicyProfile = 'CREW_FIRST' | 'BALANCED' | 'COST_FIRST';

export interface PolicyBaseParams {
  weights: QUBOWeights;
  crewRisk: CrewRadiationParams;
  missionDecision: MissionDecisionParams;
  radiationThreshold: number;
}

export interface PolicyApplication {
  profile: PolicyProfile;
  weights: QUBOWeights;
  crewRisk: CrewRadiationParams;
  missionDecision: MissionDecisionParams;
  radiationThreshold: number;
  rationale: string;
}

export function applyPolicy(
  profile: PolicyProfile,
  baseParams: PolicyBaseParams,
): PolicyApplication {
  if (profile === 'CREW_FIRST') {
    return {
      profile,
      weights: { ...baseParams.weights, rad: baseParams.weights.rad * 1.35, safety: baseParams.weights.safety * 1.25, fuel: baseParams.weights.fuel * 0.92 },
      crewRisk: { ...baseParams.crewRisk, beta: (baseParams.crewRisk.beta ?? 0.95) * 1.15, unsafeDoseRateThreshold: baseParams.radiationThreshold * 0.92 },
      missionDecision: { ...baseParams.missionDecision, embarkRiskThreshold: 0.52, continuationRiskThreshold: 0.8 },
      radiationThreshold: baseParams.radiationThreshold * 0.94,
      rationale: 'Crew-first mode lowers radiation tolerance and increases safety weighting in the optimization objective.',
    };
  }

  if (profile === 'COST_FIRST') {
    return {
      profile,
      weights: { ...baseParams.weights, fuel: baseParams.weights.fuel * 1.25, time: (baseParams.weights.time ?? 1.2) * 1.15, rad: baseParams.weights.rad * 0.9 },
      crewRisk: { ...baseParams.crewRisk, alpha: (baseParams.crewRisk.alpha ?? 0.42) * 0.96, beta: (baseParams.crewRisk.beta ?? 0.95) * 0.94 },
      missionDecision: { ...baseParams.missionDecision, embarkRiskThreshold: 0.68, continuationRiskThreshold: 0.95 },
      radiationThreshold: baseParams.radiationThreshold * 1.05,
      rationale: 'Cost-first mode preserves crew screening but prioritizes propellant and schedule efficiency more aggressively.',
    };
  }

  return {
    profile,
    weights: { ...baseParams.weights },
    crewRisk: { ...baseParams.crewRisk },
    missionDecision: { ...baseParams.missionDecision },
    radiationThreshold: baseParams.radiationThreshold,
    rationale: 'Balanced mode preserves the baseline mission trade between crew safety, trajectory cost, and schedule.',
  };
}
