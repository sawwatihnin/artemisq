export interface StakeholderViewInput {
  crewRiskScore: number;
  successProbability: number;
  riskAdjustedCost: number;
  confidenceScore: number;
  embarkationDecision: string;
  missionDecision: string;
}

export interface StakeholderView {
  crewView: string;
  controlView: string;
  financeView: string;
}

export function buildStakeholderView(input: StakeholderViewInput): StakeholderView {
  return {
    crewView: `Crew perspective: embarkation posture is ${input.embarkationDecision.toLowerCase().replaceAll('_', ' ')}, with modeled radiation score ${input.crewRiskScore.toFixed(2)}.`,
    controlView: `Mission control perspective: ${input.missionDecision.toLowerCase()} remains the operational posture with ${(input.successProbability * 100).toFixed(0)}% modeled completion probability and confidence ${input.confidenceScore.toFixed(0)}/100.`,
    financeView: `Finance perspective: current preferred decision carries risk-adjusted expected cost ${input.riskAdjustedCost.toFixed(0)}.`,
  };
}
