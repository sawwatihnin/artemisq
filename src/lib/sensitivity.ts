export type SensitivityLabel = 'low' | 'medium' | 'high';

export interface SensitivityAnalysisResult {
  parameterImpacts: Record<string, SensitivityLabel>;
  sensitivities: Record<string, number>;
}

export interface SensitivityOutputs {
  cost: number;
  risk: number;
  success?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function labelFromMagnitude(value: number): SensitivityLabel {
  if (value >= 0.2) return 'high';
  if (value >= 0.08) return 'medium';
  return 'low';
}

export function runSensitivityAnalysis(
  params: Record<string, number>,
  path: unknown,
  evaluate?: (perturbedParams: Record<string, number>, path: unknown) => SensitivityOutputs,
): SensitivityAnalysisResult {
  const sensitivities: Record<string, number> = {};
  const parameterImpacts: Record<string, SensitivityLabel> = {};
  const baseline = evaluate?.(params, path) ?? { cost: 1, risk: 1, success: 1 };

  for (const [name, value] of Object.entries(params)) {
    const delta = Math.max(Math.abs(value) * 0.05, 0.01);
    const lower = { ...params, [name]: value - delta };
    const upper = { ...params, [name]: value + delta };
    const lowerEval = evaluate?.(lower, path) ?? baseline;
    const upperEval = evaluate?.(upper, path) ?? baseline;

    const costShift = Math.abs(upperEval.cost - lowerEval.cost) / Math.max(Math.abs(baseline.cost), 1);
    const riskShift = Math.abs(upperEval.risk - lowerEval.risk) / Math.max(Math.abs(baseline.risk), 1);
    const successShift = Math.abs((upperEval.success ?? baseline.success ?? 1) - (lowerEval.success ?? baseline.success ?? 1));
    const normalized = clamp(0.45 * costShift + 0.45 * riskShift + 0.1 * successShift, 0, 1);

    sensitivities[name] = normalized;
    parameterImpacts[name] = labelFromMagnitude(normalized);
  }

  return { parameterImpacts, sensitivities };
}
