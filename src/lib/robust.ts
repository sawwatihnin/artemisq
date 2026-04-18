export interface RobustRiskSample {
  risk: number;
}

export interface RobustPathCandidate {
  name: string;
  path: string[];
  expectedRisk: number;
  expectedCost: number;
  riskSamples: number[];
}

export interface RobustOptimizationResult {
  expectedPath: RobustPathCandidate;
  robustPath: RobustPathCandidate;
  tradeoffAnalysis: string[];
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function computeWorstCaseRisk(samples: Array<number | RobustRiskSample>): {
  worstCaseRisk: number;
  p95Risk: number;
  meanRisk: number;
} {
  const values = samples.map((sample) => typeof sample === 'number' ? sample : sample.risk);
  const meanRisk = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    worstCaseRisk: values.length ? Math.max(...values) : 0,
    p95Risk: quantile(values, 0.95),
    meanRisk,
  };
}

export function optimizeForWorstCase(pathSet: RobustPathCandidate[]): RobustOptimizationResult {
  const expectedPath = [...pathSet].sort((a, b) => (
    (a.expectedCost + 120 * a.expectedRisk) - (b.expectedCost + 120 * b.expectedRisk)
  ))[0];

  const robustPath = [...pathSet].sort((a, b) => {
    const aWorst = computeWorstCaseRisk(a.riskSamples);
    const bWorst = computeWorstCaseRisk(b.riskSamples);
    return (aWorst.p95Risk + 0.001 * a.expectedCost) - (bWorst.p95Risk + 0.001 * b.expectedCost);
  })[0];

  const expectedWorst = computeWorstCaseRisk(expectedPath?.riskSamples ?? []);
  const robustWorst = computeWorstCaseRisk(robustPath?.riskSamples ?? []);

  return {
    expectedPath,
    robustPath,
    tradeoffAnalysis: [
      `Expected-optimal path ${expectedPath?.name ?? 'N/A'} minimizes mean objective with mean risk ${expectedWorst.meanRisk.toFixed(2)}.`,
      `Worst-case-optimal path ${robustPath?.name ?? 'N/A'} reduces 95th-percentile risk to ${robustWorst.p95Risk.toFixed(2)}.`,
      `Robustness premium is ${Math.max(0, (robustPath?.expectedCost ?? 0) - (expectedPath?.expectedCost ?? 0)).toFixed(1)} cost units.`,
    ],
  };
}
