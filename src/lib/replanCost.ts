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

export function assessDecisionCost(
  option: ReplanOption,
  params: ReplanCostParams = {},
): DecisionCostAssessment {
  const deltaVCostPerMs = params.deltaVCostPerMs ?? 1800;
  const delayCostPerHour = params.delayCostPerHour ?? 95000;
  const missionSupportOverhead = params.missionSupportOverhead ?? 850000;
  const scienceDelayCostPerHour = params.scienceDelayCostPerHour ?? 62000;
  const crewTimeValuePerHour = params.crewTimeValuePerHour ?? 18000;
  const resourceReallocationFactor = params.resourceReallocationFactor ?? 450000;
  const failurePenalty = params.failurePenalty ?? 125000000;
  const sunkMissionCost = params.sunkMissionCost ?? 420000000;
  const lostMissionValue = params.lostMissionValue ?? 310000000;
  const recoveryOperationsCost = params.recoveryOperationsCost ?? 75000000;
  const nominalContinuationCost = params.nominalContinuationCost ?? 120000000;
  const projectedHealthRiskPenaltyFactor = params.projectedHealthRiskPenaltyFactor ?? 210000000;
  const projectedFailurePenaltyFactor = params.projectedFailurePenaltyFactor ?? 180000000;

  const directMissionCost =
    Math.max(0, option.deltaVChange) * deltaVCostPerMs +
    Math.max(0, option.missionDurationChange) * delayCostPerHour +
    missionSupportOverhead * (0.35 + option.operationalComplexity);

  const indirectOpportunityCost =
    Math.max(0, option.missionDurationChange) * scienceDelayCostPerHour +
    Math.max(0, option.missionDurationChange) * crewTimeValuePerHour +
    option.operationalComplexity * resourceReallocationFactor;

  const abortCost = option.type === 'ABORT'
    ? sunkMissionCost + lostMissionValue + recoveryOperationsCost
    : 0;

  const continueRiskAdjustedCost = option.type === 'CONTINUE'
    ? nominalContinuationCost +
      option.newTotalMissionRisk * projectedHealthRiskPenaltyFactor +
      (1 - option.probabilityOfSuccess) * projectedFailurePenaltyFactor
    : 0;

  const directCost = directMissionCost + abortCost + continueRiskAdjustedCost;
  const indirectCost = indirectOpportunityCost + (option.type === 'ABORT' ? lostMissionValue * 0.08 : 0);
  const riskAdjustedCost = directCost + indirectCost + (1 - option.probabilityOfSuccess) * failurePenalty;
  const recommendationValueScore = option.riskReduction / Math.max(1, directCost + indirectCost);

  return {
    optionName: option.name,
    directCost,
    indirectCost,
    riskAdjustedCost,
    costBreakdown: [
      { category: 'Added fuel / delta-v cost', value: Math.max(0, option.deltaVChange) * deltaVCostPerMs },
      { category: 'Additional ground operations', value: missionSupportOverhead * (0.35 + option.operationalComplexity) },
      { category: 'Delay cost', value: Math.max(0, option.missionDurationChange) * delayCostPerHour },
      { category: 'Scientific opportunity cost', value: Math.max(0, option.missionDurationChange) * scienceDelayCostPerHour },
      { category: 'Crew time utilization loss', value: Math.max(0, option.missionDurationChange) * crewTimeValuePerHour },
      { category: 'Resource reallocation burden', value: option.operationalComplexity * resourceReallocationFactor },
      { category: 'Abort-specific cost', value: abortCost },
      { category: 'Continuation risk penalty', value: continueRiskAdjustedCost },
      { category: 'Expected failure penalty', value: (1 - option.probabilityOfSuccess) * failurePenalty },
    ].filter((line) => line.value > 0),
    recommendationValueScore,
  };
}
