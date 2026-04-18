export interface CounterfactualScenario {
  name: string;
  deltaRisk: number;
  deltaCost: number;
  deltaSuccessProbability: number;
  explanation: string;
}

export interface CounterfactualResult {
  scenarios: CounterfactualScenario[];
  outcomeDifferences: string[];
}

export interface CounterfactualParams {
  baselineRisk: number;
  baselineCost: number;
  baselineSuccessProbability: number;
  delayedLaunchHours?: number;
  increasedShieldingKg?: number;
  alternateRouteRisk?: number;
  alternateRouteCost?: number;
}

export function generateCounterfactuals(
  _path: string[],
  params: CounterfactualParams,
): CounterfactualResult {
  const delayedLaunchHours = params.delayedLaunchHours ?? 12;
  const increasedShieldingKg = params.increasedShieldingKg ?? 120;
  const scenarios: CounterfactualScenario[] = [
    {
      name: 'Delayed launch',
      deltaRisk: -0.003 * delayedLaunchHours,
      deltaCost: 1_800_000 * (delayedLaunchHours / 6),
      deltaSuccessProbability: 0.012 * (delayedLaunchHours / 6),
      explanation: `Waiting ${delayedLaunchHours} hours reduces projected environmental forcing at modest schedule cost.`,
    },
    {
      name: 'Increased shielding',
      deltaRisk: -0.0009 * increasedShieldingKg,
      deltaCost: 240_000 * increasedShieldingKg,
      deltaSuccessProbability: 0.008,
      explanation: `Additional shielding of ${increasedShieldingKg} kg lowers absorbed dose but raises mass-driven mission cost.`,
    },
    {
      name: 'Alternate route',
      deltaRisk: (params.alternateRouteRisk ?? params.baselineRisk * 0.82) - params.baselineRisk,
      deltaCost: (params.alternateRouteCost ?? params.baselineCost * 1.07) - params.baselineCost,
      deltaSuccessProbability: 0.03,
      explanation: 'Route diversification changes both exposure geometry and operational complexity.',
    },
  ];

  return {
    scenarios,
    outcomeDifferences: scenarios.map((scenario) =>
      `${scenario.name} changes risk by ${scenario.deltaRisk.toFixed(2)}, cost by ${scenario.deltaCost.toFixed(0)}, and success probability by ${(scenario.deltaSuccessProbability * 100).toFixed(1)}%.`,
    ),
  };
}
