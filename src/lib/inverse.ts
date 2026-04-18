import type { PolicyProfile } from './policy';
import type { LaunchWindowEvaluation } from './launchWindow';
import { computeMassPenalty, computeShieldingEffect } from './shielding';

export interface InverseTargets {
  targetRisk: number;
  targetCost: number;
  baseRisk?: number;
  baseCost?: number;
  baseSuccessProbability?: number;
  baseDeltaV_ms?: number;
  spacecraftMassKg?: number;
  habitatAreaM2?: number;
  isp_s?: number;
  launchWindows?: LaunchWindowEvaluation[];
  maxShieldingKg?: number;
  maxLaunchDelayHours?: number;
}

export interface InverseCandidate {
  weights: { fuel: number; rad: number; comm: number; safety: number; time: number };
  shieldingLevel: number;
  launchWindow: number;
  policy: PolicyProfile;
}

export interface InverseOutcome {
  risk: number;
  cost: number;
  successProbability: number;
}

export interface InverseOptimizationResult {
  recommendedWeights: InverseCandidate['weights'];
  shieldingLevel: number;
  launchWindow: number;
  expectedOutcome: InverseOutcome;
  policy: PolicyProfile;
}

function evaluateCandidate(candidate: InverseCandidate, targets: InverseTargets): InverseOutcome {
  const baseRisk = targets.baseRisk ?? 0.7;
  const baseCost = targets.baseCost ?? 120_000_000;
  const baseSuccessProbability = targets.baseSuccessProbability ?? 0.82;
  const baseDeltaV_ms = targets.baseDeltaV_ms ?? 3800;
  const spacecraftMassKg = targets.spacecraftMassKg ?? 5000;
  const habitatAreaM2 = targets.habitatAreaM2 ?? 18;
  const isp_s = targets.isp_s ?? 450;
  const window = targets.launchWindows?.find((entry) => entry.window.offsetHours === candidate.launchWindow) ?? targets.launchWindows?.[0];
  const shielding = computeShieldingEffect(candidate.shieldingLevel, { habitatAreaM2 });
  const massPenalty = computeMassPenalty(candidate.shieldingLevel, {
    spacecraftMassKg,
    baseDeltaV_ms,
    isp_s,
  });
  const windowRiskScale = window
    ? window.radiationExposure / Math.max(targets.launchWindows?.[0]?.radiationExposure ?? window.radiationExposure, 1e-6)
    : 1 + 0.003 * candidate.launchWindow;
  const windowCostScale = window
    ? window.deltaV_ms / Math.max(baseDeltaV_ms, 1)
    : 1 + 0.0025 * candidate.launchWindow;
  const commBonus = window?.communicationAvailability ?? Math.max(0.55, 0.9 - 0.005 * candidate.launchWindow);

  const risk = Math.max(
    0.08,
    baseRisk
      * shielding.radiationMultiplier
      * windowRiskScale
      * (1 + 0.16 * candidate.weights.fuel - 0.22 * candidate.weights.rad - 0.18 * candidate.weights.safety)
      * (1 - 0.08 * commBonus),
  );
  const cost = baseCost
    + candidate.shieldingLevel * 18_000
    + massPenalty.equivalentPropellantKg * 7_500
    + Math.max(0, (window?.deltaV_ms ?? baseDeltaV_ms) - baseDeltaV_ms) * 2_400
    + 95_000 * candidate.launchWindow
    + 4_000_000 * Math.max(0, candidate.weights.time - 0.1)
    + baseCost * Math.max(0, windowCostScale - 1) * 0.08;
  const successProbability = Math.max(
    0.35,
    Math.min(
      0.995,
      baseSuccessProbability
        - 0.28 * (risk - baseRisk)
        + 0.04 * candidate.weights.comm
        + 0.03 * candidate.weights.safety
        + 0.05 * commBonus
        - 0.08 * massPenalty.massRatio,
    ),
  );
  return { risk, cost, successProbability };
}

function distanceToTargets(outcome: InverseOutcome, targets: InverseTargets): number {
  const riskError = (outcome.risk - targets.targetRisk) / Math.max(targets.targetRisk, 0.1);
  const costError = (outcome.cost - targets.targetCost) / Math.max(targets.targetCost, 1);
  return riskError * riskError + costError * costError - 0.05 * outcome.successProbability;
}

export function findFeasibleParameters(targets: InverseTargets): InverseOptimizationResult[] {
  const maxShieldingKg = targets.maxShieldingKg ?? 500;
  const maxLaunchDelayHours = targets.maxLaunchDelayHours ?? 36;
  const availableLaunchWindows = targets.launchWindows?.map((entry) => entry.window.offsetHours)
    ?? [0, 6, 12, 24, 36];
  const candidates: InverseOptimizationResult[] = [];

  for (const shieldingLevel of [0, 80, 160, 240, 320, 400, 480].filter((value) => value <= maxShieldingKg)) {
    for (const launchWindow of availableLaunchWindows.filter((value) => value <= maxLaunchDelayHours)) {
      for (const profile of ['CREW_FIRST', 'BALANCED', 'COST_FIRST'] as const) {
        const weights = profile === 'CREW_FIRST'
          ? { fuel: 0.16, rad: 0.32, comm: 0.16, safety: 0.26, time: 0.1 }
          : profile === 'COST_FIRST'
            ? { fuel: 0.28, rad: 0.2, comm: 0.16, safety: 0.2, time: 0.16 }
            : { fuel: 0.2, rad: 0.28, comm: 0.16, safety: 0.24, time: 0.12 };
        const outcome = evaluateCandidate({ weights, shieldingLevel, launchWindow, policy: profile }, targets);
        candidates.push({
          recommendedWeights: weights,
          shieldingLevel,
          launchWindow,
          expectedOutcome: outcome,
          policy: profile,
        });
      }
    }
  }

  return candidates.sort((a, b) => distanceToTargets(a.expectedOutcome, targets) - distanceToTargets(b.expectedOutcome, targets));
}

export function optimizeForTargetOutcome(targets: InverseTargets): InverseOptimizationResult {
  return findFeasibleParameters(targets)[0];
}
