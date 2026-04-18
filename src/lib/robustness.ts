export interface RobustnessInputSample {
  cost?: number;
  risk?: number;
  success?: number;
}

export interface RobustnessResult {
  robustnessScore: number;
  fragilityIndicators: string[];
}

function variance(values: number[]): number {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

export function computeRobustness(samples: Array<number | RobustnessInputSample>): RobustnessResult {
  const normalized = samples.map((sample) => typeof sample === 'number'
    ? { cost: sample, risk: sample, success: 1 - sample }
    : {
        cost: sample.cost ?? 0,
        risk: sample.risk ?? 0,
        success: sample.success ?? 0.5,
      });

  const costVar = variance(normalized.map((sample) => sample.cost));
  const riskVar = variance(normalized.map((sample) => sample.risk));
  const successVar = variance(normalized.map((sample) => sample.success));
  const aggregateVariance = 0.4 * riskVar + 0.35 * costVar + 0.25 * successVar;
  const robustnessScore = 1 / (1 + aggregateVariance);
  const fragilityIndicators: string[] = [];

  if (riskVar > 0.05) fragilityIndicators.push('risk is highly scenario-sensitive');
  if (costVar > 4000) fragilityIndicators.push('cost response is unstable under perturbations');
  if (successVar > 0.03) fragilityIndicators.push('mission completion probability swings materially across samples');
  if (!fragilityIndicators.length) fragilityIndicators.push('no dominant fragility mode detected under current perturbations');

  return {
    robustnessScore,
    fragilityIndicators,
  };
}
