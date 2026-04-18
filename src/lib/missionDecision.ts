import type { CrewRadiationReadiness } from './crewRisk';

export type MissionDecision = 'CONTINUE' | 'REPLAN' | 'ABORT';
export type UrgencyLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface DecisionPathCandidate {
  name: string;
  path: string[];
  projectedRiskScore: number;
  communicationStability: number;
  returnFeasibility: number;
  missionProgressGain: number;
}

export interface MissionDecisionParams {
  embarkRiskThreshold?: number;
  acuteThreshold?: number;
  continuationRiskThreshold?: number;
  returnFeasibility?: number;
  communicationStability?: number;
  missionProgress?: number;
  forecastRemainingRisk?: number;
  alternateCorridorAvailable?: boolean;
}

export interface MissionDecisionResult {
  decision: MissionDecision;
  urgencyLevel: UrgencyLevel;
  rationale: string;
  candidateActions: string[];
  expectedRiskReduction: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function generateDecisionRationale(
  decision: MissionDecision,
  metrics: {
    crewRiskScore: number;
    peakExposure: number;
    forecastRemainingRisk: number;
    returnFeasibility: number;
    communicationStability: number;
    missionProgress: number;
  },
): string {
  if (decision === 'ABORT') {
    return `Abort is recommended because crew risk ${metrics.crewRiskScore.toFixed(2)} and forecast remaining risk ${metrics.forecastRemainingRisk.toFixed(2)} exceed continuation tolerances while return feasibility remains ${metrics.returnFeasibility >= 0.6 ? 'acceptable' : 'marginal'} for crew recovery.`;
  }
  if (decision === 'REPLAN') {
    return `Replan is recommended because current crew risk ${metrics.crewRiskScore.toFixed(2)} is above the preferred continuation band, but communication stability ${(metrics.communicationStability * 100).toFixed(0)}% and mission progress ${(metrics.missionProgress * 100).toFixed(0)}% still leave room for a safer corridor adjustment.`;
  }
  return `Continue is acceptable because crew risk ${metrics.crewRiskScore.toFixed(2)} and projected remaining risk ${metrics.forecastRemainingRisk.toFixed(2)} remain below the action thresholds while communication stability stays operationally adequate.`;
}

export function recommendAbortOrReplan(
  path: string[],
  riskState: {
    crewRisk: CrewRadiationReadiness;
    forecastRemainingRisk: number;
    returnFeasibility: number;
    communicationStability: number;
    missionProgress: number;
  },
  candidatePaths: DecisionPathCandidate[],
): MissionDecisionResult {
  const saferCandidate = [...candidatePaths]
    .filter((candidate) => candidate.projectedRiskScore < riskState.crewRisk.riskScore)
    .sort((a, b) => {
      const aScore = a.projectedRiskScore - 0.12 * a.communicationStability - 0.12 * a.returnFeasibility;
      const bScore = b.projectedRiskScore - 0.12 * b.communicationStability - 0.12 * b.returnFeasibility;
      return aScore - bScore;
    })[0];

  if (saferCandidate) {
    return {
      decision: 'REPLAN',
      urgencyLevel: riskState.crewRisk.peakExposure > 1.05 ? 'HIGH' : 'MODERATE',
      rationale: `Replan toward ${saferCandidate.name} because it projects risk ${saferCandidate.projectedRiskScore.toFixed(2)} versus current ${riskState.crewRisk.riskScore.toFixed(2)} while preserving ${(saferCandidate.communicationStability * 100).toFixed(0)}% communication stability.`,
      candidateActions: [
        `Transition to ${saferCandidate.name}`,
        'Increase radiation monitoring cadence',
        'Reassess after the next mission epoch',
      ],
      expectedRiskReduction: clamp(riskState.crewRisk.riskScore - saferCandidate.projectedRiskScore, 0, 1.5),
    };
  }

  return {
    decision: 'ABORT',
    urgencyLevel: riskState.crewRisk.peakExposure > 1.05 ? 'CRITICAL' : 'HIGH',
    rationale: `Abort is favored because no alternate corridor improves crew risk enough to justify continuation from the current path ${path.join(' -> ')}.`,
    candidateActions: [
      'Initiate free-return or direct-return sequence',
      'Stabilize communications and crew shelter configuration',
      'Prioritize recovery operations',
    ],
    expectedRiskReduction: clamp(riskState.crewRisk.riskScore, 0, 1.5),
  };
}

export function evaluateMissionDecision(
  path: string[],
  crewRisk: CrewRadiationReadiness,
  params: MissionDecisionParams = {},
): MissionDecisionResult {
  const embarkRiskThreshold = params.embarkRiskThreshold ?? 0.6;
  const acuteThreshold = params.acuteThreshold ?? 1.05;
  const continuationRiskThreshold = params.continuationRiskThreshold ?? 0.88;
  const forecastRemainingRisk = params.forecastRemainingRisk ?? crewRisk.riskScore * 0.65;
  const returnFeasibility = params.returnFeasibility ?? 0.78;
  const communicationStability = params.communicationStability ?? 0.8;
  const missionProgress = params.missionProgress ?? 0;
  const alternateCorridorAvailable = params.alternateCorridorAvailable ?? false;

  const severeAcute = crewRisk.peakExposure >= acuteThreshold;
  const excessiveForecast = forecastRemainingRisk >= continuationRiskThreshold;

  let decision: MissionDecision = 'CONTINUE';
  let urgencyLevel: UrgencyLevel = 'LOW';
  const candidateActions: string[] = [];

  if (crewRisk.embarkationDecision === 'DO_NOT_EMBARK' && missionProgress <= 0.05) {
    decision = alternateCorridorAvailable ? 'REPLAN' : 'ABORT';
    urgencyLevel = severeAcute ? 'CRITICAL' : 'HIGH';
    candidateActions.push(alternateCorridorAvailable ? 'Delay launch and shift to lower-radiation corridor' : 'Hold mission and preserve crew on ground');
  } else if (severeAcute || excessiveForecast) {
    if (alternateCorridorAvailable && communicationStability >= 0.55) {
      decision = 'REPLAN';
      urgencyLevel = severeAcute ? 'HIGH' : 'MODERATE';
      candidateActions.push('Execute safer corridor retargeting');
    } else {
      decision = returnFeasibility >= 0.55 ? 'ABORT' : 'REPLAN';
      urgencyLevel = severeAcute ? 'CRITICAL' : 'HIGH';
      candidateActions.push(decision === 'ABORT' ? 'Prepare return and crew shelter configuration' : 'Constrain profile and shorten mission');
    }
  } else if (crewRisk.riskScore >= embarkRiskThreshold || communicationStability < 0.6) {
    decision = alternateCorridorAvailable ? 'REPLAN' : 'CONTINUE';
    urgencyLevel = alternateCorridorAvailable ? 'MODERATE' : 'LOW';
    candidateActions.push(alternateCorridorAvailable ? 'Monitor for lower-risk replan trigger' : 'Continue with elevated medical surveillance');
  } else {
    candidateActions.push('Continue nominal mission execution');
  }

  if (decision !== 'ABORT') candidateActions.push('Continue dosimetry trending and threshold surveillance');
  if (decision === 'REPLAN') candidateActions.push('Validate return corridor feasibility before maneuver commit');

  return {
    decision,
    urgencyLevel,
    rationale: generateDecisionRationale(decision, {
      crewRiskScore: crewRisk.riskScore,
      peakExposure: crewRisk.peakExposure,
      forecastRemainingRisk,
      returnFeasibility,
      communicationStability,
      missionProgress,
    }),
    candidateActions,
    expectedRiskReduction: decision === 'CONTINUE'
      ? 0
      : decision === 'REPLAN'
        ? clamp(crewRisk.riskScore - Math.max(0.2, forecastRemainingRisk * 0.75), 0, 1.5)
        : clamp(crewRisk.riskScore, 0, 1.5),
  };
}
