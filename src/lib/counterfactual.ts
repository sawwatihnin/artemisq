import { computeCoupledEffects } from './coupling';
import { computeMassPenalty, computeShieldingEffect } from './shielding';

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
  baselineDeltaV_ms?: number;
  baselineCommunication?: number;
  spacecraftMassKg?: number;
  habitatAreaM2?: number;
  isp_s?: number;
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
  const baselineDeltaV_ms = params.baselineDeltaV_ms ?? 3800;
  const baselineCommunication = params.baselineCommunication ?? 0.82;
  const spacecraftMassKg = params.spacecraftMassKg ?? 5000;
  const habitatAreaM2 = params.habitatAreaM2 ?? 18;
  const isp_s = params.isp_s ?? 450;
  const shielding = computeShieldingEffect(increasedShieldingKg, { habitatAreaM2 });
  const shieldingMassPenalty = computeMassPenalty(increasedShieldingKg, {
    spacecraftMassKg,
    baseDeltaV_ms: baselineDeltaV_ms,
    isp_s,
  });
  const coupling = computeCoupledEffects({
    shieldingMassKg: increasedShieldingKg,
    launchDelayHours: delayedLaunchHours,
    replanCount: params.alternateRouteRisk != null ? 1 : 0,
    baselineDeltaV_ms,
    baselineCost: params.baselineCost,
    baselineRadiationRisk: params.baselineRisk,
  });
  const scenarios: CounterfactualScenario[] = [
    {
      name: 'Delayed launch',
      deltaRisk: coupling.aggregate.radiationRiskShift * 0.35,
      deltaCost: delayedLaunchHours * 95_000 + Math.max(0, coupling.aggregate.costShift * 0.08),
      deltaSuccessProbability: 0.015 * (delayedLaunchHours / 6) * Math.max(0.4, baselineCommunication),
      explanation: `Waiting ${delayedLaunchHours} hours shifts the launch geometry and communication alignment, changing risk through time-of-departure and forcing conditions.`,
    },
    {
      name: 'Increased shielding',
      deltaRisk: -params.baselineRisk * shielding.shieldingFactor,
      deltaCost: shieldingMassPenalty.equivalentPropellantKg * 7_500 + increasedShieldingKg * 18_000,
      deltaSuccessProbability: 0.012 - 0.018 * shieldingMassPenalty.massRatio,
      explanation: `Additional shielding of ${increasedShieldingKg} kg lowers absorbed dose through areal-density attenuation, but the added mass raises equivalent propellant demand.`,
    },
    {
      name: 'Alternate route',
      deltaRisk: (params.alternateRouteRisk ?? params.baselineRisk * 0.82) - params.baselineRisk,
      deltaCost: (params.alternateRouteCost ?? params.baselineCost * 1.07) - params.baselineCost,
      deltaSuccessProbability: Math.max(-0.04, 0.03 - 0.02 * Math.max(0, ((params.alternateRouteCost ?? params.baselineCost) - params.baselineCost) / Math.max(params.baselineCost, 1))),
      explanation: 'Route diversification changes both exposure geometry and operational complexity using the actual candidate replan economics and projected risk.',
    },
  ];

  return {
    scenarios,
    outcomeDifferences: scenarios.map((scenario) =>
      `${scenario.name} changes risk by ${scenario.deltaRisk.toFixed(2)}, cost by ${scenario.deltaCost.toFixed(0)}, and success probability by ${(scenario.deltaSuccessProbability * 100).toFixed(1)}%.`,
    ),
  };
}
