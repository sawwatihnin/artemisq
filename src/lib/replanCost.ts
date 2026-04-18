import type { ReplanOption } from './replan';

export interface CostBreakdownLine {
  category: string;
  value: number;
}

export interface DecisionCostAssessment {
  optionName: string;
  directCost: number;
  indirectCost: number;
  riskAdjustedCost: number;
  costBreakdown: CostBreakdownLine[];
  recommendationValueScore: number;
}

export interface ReplanCostParams {
  deltaVCostPerMs?: number;
  delayCostPerHour?: number;
  missionSupportOverhead?: number;
  scienceDelayCostPerHour?: number;
  crewTimeValuePerHour?: number;
  resourceReallocationFactor?: number;
  failurePenalty?: number;
  sunkMissionCost?: number;
  lostMissionValue?: number;
  recoveryOperationsCost?: number;
  nominalContinuationCost?: number;
  projectedHealthRiskPenaltyFactor?: number;
  projectedFailurePenaltyFactor?: number;
}

export function calculateDirectMissionCost(
  option: Pick<ReplanOption, 'deltaVChange' | 'missionDurationChange' | 'operationalComplexity'>,
  params: ReplanCostParams = {},
): number {
  const deltaVCostPerMs = params.deltaVCostPerMs ?? 1800;
  const delayCostPerHour = params.delayCostPerHour ?? 95000;
  const missionSupportOverhead = params.missionSupportOverhead ?? 850000;
  return (
    Math.max(0, option.deltaVChange) * deltaVCostPerMs +
    Math.max(0, option.missionDurationChange) * delayCostPerHour +
    missionSupportOverhead * (0.35 + option.operationalComplexity)
  );
}

export function calculateIndirectOpportunityCost(
  option: Pick<ReplanOption, 'missionDurationChange' | 'operationalComplexity' | 'type'>,
  params: ReplanCostParams = {},
): number {
  const scienceDelayCostPerHour = params.scienceDelayCostPerHour ?? 62000;
  const crewTimeValuePerHour = params.crewTimeValuePerHour ?? 18000;
  const resourceReallocationFactor = params.resourceReallocationFactor ?? 450000;
  const lostMissionValue = params.lostMissionValue ?? 310000000;
  return (
    Math.max(0, option.missionDurationChange) * scienceDelayCostPerHour +
    Math.max(0, option.missionDurationChange) * crewTimeValuePerHour +
    option.operationalComplexity * resourceReallocationFactor +
    (option.type === 'ABORT' ? lostMissionValue * 0.08 : 0)
  );
}

export function calculateAbortCost(params: ReplanCostParams = {}): number {
  const sunkMissionCost = params.sunkMissionCost ?? 420000000;
  const lostMissionValue = params.lostMissionValue ?? 310000000;
  const recoveryOperationsCost = params.recoveryOperationsCost ?? 75000000;
  return sunkMissionCost + lostMissionValue + recoveryOperationsCost;
}

export function calculateContinueRiskAdjustedCost(
  option: Pick<ReplanOption, 'newTotalMissionRisk' | 'probabilityOfSuccess'>,
  params: ReplanCostParams = {},
): number {
  const nominalContinuationCost = params.nominalContinuationCost ?? 120000000;
  const projectedHealthRiskPenaltyFactor = params.projectedHealthRiskPenaltyFactor ?? 210000000;
  const projectedFailurePenaltyFactor = params.projectedFailurePenaltyFactor ?? 180000000;
  return (
    nominalContinuationCost +
    option.newTotalMissionRisk * projectedHealthRiskPenaltyFactor +
    (1 - option.probabilityOfSuccess) * projectedFailurePenaltyFactor
  );
}

export function calculateRiskAdjustedExpectedCost(
  option: Pick<ReplanOption, 'probabilityOfSuccess'>,
  directCost: number,
  indirectCost: number,
  params: ReplanCostParams = {},
): number {
  const failurePenalty = params.failurePenalty ?? 125000000;
  return directCost + indirectCost + (1 - option.probabilityOfSuccess) * failurePenalty;
}

export function calculateRecommendationValueScore(
  riskReduction: number,
  addedCost: number,
): number {
  return riskReduction / Math.max(1, addedCost);
}

export function assessDecisionCost(
  option: ReplanOption,
  params: ReplanCostParams = {},
): DecisionCostAssessment {
  const directMissionCost = calculateDirectMissionCost(option, params);
  const indirectOpportunityCost = calculateIndirectOpportunityCost(option, params);
  const abortCost = option.type === 'ABORT'
    ? calculateAbortCost(params)
    : 0;
  const continueRiskAdjustedCost = option.type === 'CONTINUE'
    ? calculateContinueRiskAdjustedCost(option, params)
    : 0;
  const directCost = directMissionCost + abortCost + continueRiskAdjustedCost;
  const indirectCost = indirectOpportunityCost;
  const riskAdjustedCost = calculateRiskAdjustedExpectedCost(option, directCost, indirectCost, params);
  const recommendationValueScore = calculateRecommendationValueScore(option.riskReduction, directCost + indirectCost);

  return {
    optionName: option.name,
    directCost,
    indirectCost,
    riskAdjustedCost,
    costBreakdown: [
      { category: 'Added fuel / delta-v cost', value: Math.max(0, option.deltaVChange) * (params.deltaVCostPerMs ?? 1800) },
      { category: 'Additional ground operations', value: (params.missionSupportOverhead ?? 850000) * (0.35 + option.operationalComplexity) },
      { category: 'Delay cost', value: Math.max(0, option.missionDurationChange) * (params.delayCostPerHour ?? 95000) },
      { category: 'Scientific opportunity cost', value: Math.max(0, option.missionDurationChange) * (params.scienceDelayCostPerHour ?? 62000) },
      { category: 'Crew time utilization loss', value: Math.max(0, option.missionDurationChange) * (params.crewTimeValuePerHour ?? 18000) },
      { category: 'Resource reallocation burden', value: option.operationalComplexity * (params.resourceReallocationFactor ?? 450000) },
      { category: 'Abort-specific cost', value: abortCost },
      { category: 'Continuation risk penalty', value: continueRiskAdjustedCost },
      { category: 'Expected failure penalty', value: (1 - option.probabilityOfSuccess) * (params.failurePenalty ?? 125000000) },
    ].filter((line) => line.value > 0),
    recommendationValueScore,
  };
}

export function compareDecisionCosts(
  options: ReplanOption[],
  params: ReplanCostParams = {},
): DecisionCostAssessment[] {
  return options
    .map((option) => assessDecisionCost(option, params))
    .sort((a, b) => a.riskAdjustedCost - b.riskAdjustedCost);
}
