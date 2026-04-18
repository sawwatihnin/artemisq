export interface ExplainNodeMetric {
  id: string;
  name: string;
  fuelPenalty: number;
  radiationPenalty: number;
  communicationPenalty: number;
  safetyPenalty: number;
  timePenalty: number;
  reasons: string[];
}

export interface ExplainMetrics {
  fuel: number;
  radiation: number;
  communication: number;
  safety: number;
  time: number;
}

export interface PathExplanation {
  summary: string[];
  avoidedNodes: ExplainNodeMetric[];
  contributionBreakdown: Array<{ term: string; value: number; percentage: number }>;
}

export interface CrewRiskNarrative {
  medicalRisk: string;
  operationalDecision: string;
  financialRecommendation: string;
}

/**
 * @param candidates Per-node explanation metrics: include path nodes plus off-path graph nodes
 *   so `avoidedNodes` can surface real alternatives (the optimizer passes both).
 */
export function explainPath(
  path: string[],
  metrics: ExplainMetrics,
  candidates: ExplainNodeMetric[],
): PathExplanation {
  const total = Math.max(
    1e-9,
    metrics.fuel + metrics.radiation + metrics.communication + metrics.safety + metrics.time,
  );

  const contributionBreakdown = [
    { term: 'Fuel', value: metrics.fuel, percentage: (metrics.fuel / total) * 100 },
    { term: 'Radiation', value: metrics.radiation, percentage: (metrics.radiation / total) * 100 },
    { term: 'Communication', value: metrics.communication, percentage: (metrics.communication / total) * 100 },
    { term: 'Safety', value: metrics.safety, percentage: (metrics.safety / total) * 100 },
    { term: 'Time', value: metrics.time, percentage: (metrics.time / total) * 100 },
  ];

  const avoidedNodes = candidates
    .filter((candidate) => !path.includes(candidate.id))
    .sort((a, b) => {
      const aScore = a.fuelPenalty + a.radiationPenalty + a.communicationPenalty + a.safetyPenalty + a.timePenalty;
      const bScore = b.fuelPenalty + b.radiationPenalty + b.communicationPenalty + b.safetyPenalty + b.timePenalty;
      return bScore - aScore;
    })
    .slice(0, 5);

  const sortedByShare = [...contributionBreakdown].sort((a, b) => b.percentage - a.percentage);
  const summary = [
    `Trajectory spans ${path.length} decision epochs from ${path[0]} to ${path[path.length - 1]}.`,
    `Dominant cost driver is ${sortedByShare[0]?.term.toLowerCase() ?? 'unknown'}.`,
    avoidedNodes.length
      ? `Primary avoided alternatives were rejected for ${avoidedNodes[0].reasons.join(', ').toLowerCase()}.`
      : 'No materially inferior alternative nodes were identified in the current graph.',
  ];

  return {
    summary,
    avoidedNodes,
    contributionBreakdown,
  };
}

export function explainCrewRisk(
  assessment: {
    riskScore: number;
    classification: string;
    peakExposure: number;
    cumulativeDose: number;
    unsafeDuration: number;
  },
  validation: {
    thresholdTrace: string;
    confidenceNote: string;
  },
): string {
  return `${validation.thresholdTrace} Modeled crew radiation score is ${assessment.riskScore.toFixed(2)} with classification ${assessment.classification}, cumulative dose ${assessment.cumulativeDose.toFixed(2)}, peak exposure ${assessment.peakExposure.toFixed(2)}, and unsafe duration ${assessment.unsafeDuration.toFixed(1)} hours. ${validation.confidenceNote}`;
}

export function explainMissionDecision(
  decision: { decision: string; urgencyLevel: string; rationale: string; expectedRiskReduction: number },
  bestOption?: { name: string; newTotalMissionRisk: number; deltaVChange: number },
): string {
  if (bestOption) {
    return `${decision.rationale} The preferred action is ${decision.decision.toLowerCase()} with urgency ${decision.urgencyLevel.toLowerCase()}; ${bestOption.name} projects crew risk ${bestOption.newTotalMissionRisk.toFixed(2)} with delta-v change ${bestOption.deltaVChange.toFixed(0)} m/s and expected risk reduction ${decision.expectedRiskReduction.toFixed(2)}.`;
  }
  return `${decision.rationale} Expected risk reduction is ${decision.expectedRiskReduction.toFixed(2)}.`;
}

/** Narrative for AI / copilot layers using reduced-order ascent summary fields. */
export function explainAscentDynamics(summary: {
  max_q_kpa: number;
  peak_drag_n: number;
  stability_score: number;
  max_q_altitude_km: number;
  meco_time_s: number;
  flags: string[];
}): string {
  const flagText = summary.flags.length ? ` Flags: ${summary.flags.join('; ')}.` : '';
  return (
    `Peak dynamic pressure is ${summary.max_q_kpa.toFixed(2)} kPa near ${summary.max_q_altitude_km.toFixed(1)} km altitude, producing the dominant aerodynamic load (peak drag ${(summary.peak_drag_n / 1000).toFixed(2)} kN). ` +
    `MECO is modeled at T+${summary.meco_time_s.toFixed(0)} s. Stability score ${summary.stability_score.toFixed(0)}/100 from heuristic loads and geometry.${flagText}`
  );
}

export function explainFinancialRecommendation(
  preferred: {
    optionName: string;
    riskAdjustedCost: number;
    recommendationValueScore: number;
  },
  benchmark?: {
    optionName: string;
    riskAdjustedCost: number;
  },
): string {
  if (benchmark) {
    return `${preferred.optionName} is financially preferred because its risk-adjusted cost (${preferred.riskAdjustedCost.toFixed(0)}) remains below ${benchmark.optionName} (${benchmark.riskAdjustedCost.toFixed(0)}) while preserving the stronger risk-reduction-per-cost ratio (${preferred.recommendationValueScore.toExponential(2)}).`;
  }
  return `${preferred.optionName} offers the strongest risk-reduction-per-cost ratio (${preferred.recommendationValueScore.toExponential(2)}) in the current decision set.`;
}
