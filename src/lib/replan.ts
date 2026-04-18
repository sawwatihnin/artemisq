export type ReplanOptionType =
  | 'CONTINUE'
  | 'ALTERNATE_CORRIDOR'
  | 'DELAYED_LAUNCH'
  | 'FREE_RETURN'
  | 'SHORTENED_MISSION'
  | 'EARLY_RETURN'
  | 'SHIELDING_ADJUSTED'
  | 'ABORT';

export interface MissionGraphLike {
  nodes: Array<{ id: string; name: string; radiation: number; commScore: number }>;
  edges: Array<{ from: string; to: string; fuelCost: number; deltaV_ms?: number }>;
}

export interface ReplanContext {
  currentPath: string[];
  currentRiskScore: number;
  baselineDeltaV: number;
  baselineDurationHours: number;
  baselineCommunication: number;
  missionProgress: number;
  currentSuccessProbability: number;
}

export interface ReplanOption {
  name: string;
  type: ReplanOptionType;
  path: string[];
  newTotalMissionRisk: number;
  deltaVChange: number;
  missionDurationChange: number;
  communicationImpact: number;
  operationalComplexity: number;
  probabilityOfSuccess: number;
  riskReduction: number;
  feasibility: number;
  score: number;
  recommendation: string;
}

export interface ReplanWeights {
  risk?: number;
  deltaV?: number;
  duration?: number;
  communication?: number;
  complexity?: number;
  success?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function deriveLowRadiationPath(currentPath: string[], graph: MissionGraphLike): string[] {
  const byRisk = [...graph.nodes].sort((a, b) => (a.radiation - a.commScore * 0.15) - (b.radiation - b.commScore * 0.15));
  const start = currentPath[0];
  const end = currentPath[currentPath.length - 1];
  const middle = byRisk
    .filter((node) => node.id !== start && node.id !== end)
    .slice(0, Math.max(1, currentPath.length - 2))
    .map((node) => node.id);
  return [start, ...middle.slice(0, Math.max(0, currentPath.length - 2)), end];
}

export function scoreReplanOption(option: ReplanOption, missionWeights: ReplanWeights = {}): number {
  const weights = {
    risk: missionWeights.risk ?? 0.42,
    deltaV: missionWeights.deltaV ?? 0.12,
    duration: missionWeights.duration ?? 0.12,
    communication: missionWeights.communication ?? 0.12,
    complexity: missionWeights.complexity ?? 0.1,
    success: missionWeights.success ?? 0.12,
  };

  return (
    weights.risk * (1 - option.newTotalMissionRisk / 1.5) +
    weights.deltaV * (1 - Math.max(0, option.deltaVChange) / 2500) +
    weights.duration * (1 - Math.max(0, option.missionDurationChange) / 72) +
    weights.communication * option.communicationImpact +
    weights.success * option.probabilityOfSuccess -
    weights.complexity * option.operationalComplexity
  );
}

export function compareReplans(options: ReplanOption[]): ReplanOption[] {
  return [...options].sort((a, b) => b.score - a.score);
}

export function generateReplanOptions(
  currentState: ReplanContext,
  missionGraph: MissionGraphLike,
  params: { conservativeReturnBufferHours?: number; shieldingBenefitFraction?: number } = {},
): ReplanOption[] {
  const conservativeReturnBufferHours = params.conservativeReturnBufferHours ?? 18;
  const shieldingBenefitFraction = params.shieldingBenefitFraction ?? 0.16;
  const saferPath = deriveLowRadiationPath(currentState.currentPath, missionGraph);

  const options: ReplanOption[] = [
    {
      name: 'Continue nominal profile',
      type: 'CONTINUE',
      path: currentState.currentPath,
      newTotalMissionRisk: currentState.currentRiskScore,
      deltaVChange: 0,
      missionDurationChange: 0,
      communicationImpact: currentState.baselineCommunication,
      operationalComplexity: 0.22,
      probabilityOfSuccess: currentState.currentSuccessProbability,
      riskReduction: 0,
      feasibility: 1,
      score: 0,
      recommendation: 'Retains current mission value but preserves elevated crew risk.',
    },
    {
      name: 'Replan A · alternate corridor',
      type: 'ALTERNATE_CORRIDOR',
      path: saferPath,
      newTotalMissionRisk: clamp(currentState.currentRiskScore * 0.72, 0, 1.5),
      deltaVChange: 380,
      missionDurationChange: 10,
      communicationImpact: clamp(currentState.baselineCommunication + 0.08, 0, 1),
      operationalComplexity: 0.46,
      probabilityOfSuccess: clamp(currentState.currentSuccessProbability + 0.04, 0, 1),
      riskReduction: clamp(currentState.currentRiskScore * 0.28, 0, 1.5),
      feasibility: 0.82,
      score: 0,
      recommendation: 'Preferred when a lower-radiation corridor remains reachable without large schedule slip.',
    },
    {
      name: 'Replan B · delayed launch window',
      type: 'DELAYED_LAUNCH',
      path: currentState.currentPath,
      newTotalMissionRisk: clamp(currentState.currentRiskScore * 0.67, 0, 1.5),
      deltaVChange: 90,
      missionDurationChange: 24,
      communicationImpact: clamp(currentState.baselineCommunication + 0.03, 0, 1),
      operationalComplexity: 0.34,
      probabilityOfSuccess: clamp(currentState.currentSuccessProbability + 0.02, 0, 1),
      riskReduction: clamp(currentState.currentRiskScore * 0.33, 0, 1.5),
      feasibility: 0.9,
      score: 0,
      recommendation: 'Favored when launch timing flexibility can trade schedule for lower space-weather forcing.',
    },
    {
      name: 'Conservative free-return',
      type: 'FREE_RETURN',
      path: [currentState.currentPath[0], currentState.currentPath[Math.max(1, Math.floor(currentState.currentPath.length / 2))], currentState.currentPath[0]],
      newTotalMissionRisk: clamp(currentState.currentRiskScore * 0.58, 0, 1.5),
      deltaVChange: 620,
      missionDurationChange: -Math.min(currentState.baselineDurationHours * 0.2, 20),
      communicationImpact: clamp(currentState.baselineCommunication + 0.05, 0, 1),
      operationalComplexity: 0.52,
      probabilityOfSuccess: clamp(currentState.currentSuccessProbability + 0.01, 0, 1),
      riskReduction: clamp(currentState.currentRiskScore * 0.42, 0, 1.5),
      feasibility: 0.78,
      score: 0,
      recommendation: 'Reduces crew exposure by preserving a conservative return geometry.',
    },
    {
      name: 'Shortened mission profile',
      type: 'SHORTENED_MISSION',
      path: currentState.currentPath.slice(0, Math.max(2, currentState.currentPath.length - 1)),
      newTotalMissionRisk: clamp(currentState.currentRiskScore * 0.63, 0, 1.5),
      deltaVChange: 240,
      missionDurationChange: -Math.min(currentState.baselineDurationHours * 0.25, 26),
      communicationImpact: currentState.baselineCommunication,
      operationalComplexity: 0.38,
      probabilityOfSuccess: clamp(currentState.currentSuccessProbability + 0.03, 0, 1),
      riskReduction: clamp(currentState.currentRiskScore * 0.37, 0, 1.5),
      feasibility: 0.86,
      score: 0,
      recommendation: 'Trades mission objectives for earlier crew recovery and lower cumulative dose.',
    },
    {
      name: 'Shielding-adjusted plan',
      type: 'SHIELDING_ADJUSTED',
      path: currentState.currentPath,
      newTotalMissionRisk: clamp(currentState.currentRiskScore * (1 - shieldingBenefitFraction), 0, 1.5),
      deltaVChange: 140,
      missionDurationChange: 4,
      communicationImpact: currentState.baselineCommunication,
      operationalComplexity: 0.29,
      probabilityOfSuccess: currentState.currentSuccessProbability,
      riskReduction: clamp(currentState.currentRiskScore * shieldingBenefitFraction, 0, 1.5),
      feasibility: 0.88,
      score: 0,
      recommendation: 'Useful when localized sheltering or configuration changes materially reduce absorbed dose.',
    },
    {
      name: 'Abort and recover crew',
      type: 'ABORT',
      path: [currentState.currentPath[0]],
      newTotalMissionRisk: clamp(currentState.currentRiskScore * 0.15, 0, 1.5),
      deltaVChange: 840,
      missionDurationChange: -Math.max(currentState.baselineDurationHours * (1 - currentState.missionProgress), conservativeReturnBufferHours),
      communicationImpact: clamp(currentState.baselineCommunication + 0.12, 0, 1),
      operationalComplexity: 0.68,
      probabilityOfSuccess: clamp(currentState.currentSuccessProbability - 0.04, 0, 1),
      riskReduction: clamp(currentState.currentRiskScore * 0.85, 0, 1.5),
      feasibility: 0.74,
      score: 0,
      recommendation: 'Safest medical option, but it sacrifices mission value and demands recovery operations.',
    },
  ];

  for (const option of options) {
    option.score = scoreReplanOption(option);
  }

  return compareReplans(options);
}
