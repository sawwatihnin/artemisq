export interface MissionReportInput {
  missionName: string;
  crewRisk: { riskScore: number; classification: string; embarkationDecision: string };
  cost: { expectedCost: number; riskAdjustedCost?: number };
  missionDecision: { decision: string; rationale: string };
  confidence?: { confidenceScore: number; interpretation: string };
  counterfactuals?: { scenarios: Array<{ name: string; explanation: string }> };
  regret?: { regretScore: number; missedOpportunity: string };
  voi?: { valueOfWaiting: number; recommendation: string };
}

export interface MissionReport {
  summary: string;
  findings: string[];
  recommendations: string[];
}

export function generateMissionReport(state: MissionReportInput): MissionReport {
  const findings = [
    `Crew radiation score ${state.crewRisk.riskScore.toFixed(2)} with classification ${state.crewRisk.classification}.`,
    `Operational posture is ${state.missionDecision.decision.toLowerCase()} and expected mission cost is ${state.cost.expectedCost.toFixed(0)}.`,
    state.confidence
      ? `Mission confidence is ${state.confidence.confidenceScore.toFixed(0)}/100: ${state.confidence.interpretation}`
      : 'No mission confidence score was available.',
    ...(state.counterfactuals?.scenarios.slice(0, 3).map((scenario) => `Counterfactual ${scenario.name}: ${scenario.explanation}`) ?? []),
  ];

  const recommendations = [
    state.missionDecision.rationale,
    state.regret ? state.regret.missedOpportunity : 'No regret comparison was available.',
    state.voi ? state.voi.recommendation : 'No value-of-information recommendation was available.',
  ];

  return {
    summary: `${state.missionName}: ${state.crewRisk.embarkationDecision.toLowerCase().replaceAll('_', ' ')} with decision ${state.missionDecision.decision.toLowerCase()}.`,
    findings,
    recommendations,
  };
}
