import type { PolicyProfile } from './policy';

export interface InverseTargets {
  targetRisk: number;
  targetCost: number;
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

function evaluateCandidate(candidate: InverseCandidate): InverseOutcome {
  const risk = Math.max(0.1, 0.92 - 0.0012 * candidate.shieldingLevel - 0.006 * candidate.launchWindow + 0.18 * candidate.weights.fuel - 0.24 * candidate.weights.rad - 0.22 * candidate.weights.safety);
  const cost = 120_000_000
    + 280_000 * candidate.shieldingLevel
    + 2_500_000 * (candidate.launchWindow / 6)
    + 18_000_000 * candidate.weights.fuel
    + 8_000_000 * candidate.weights.time;
  const successProbability = Math.max(0.35, Math.min(0.99, 0.9 - 0.25 * risk + 0.04 * candidate.weights.comm + 0.03 * candidate.weights.safety));
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
  const candidates: InverseOptimizationResult[] = [];

  for (const shieldingLevel of [0, 80, 160, 240, 320, 400, 480].filter((value) => value <= maxShieldingKg)) {
    for (const launchWindow of [0, 6, 12, 24, 36].filter((value) => value <= maxLaunchDelayHours)) {
      for (const profile of ['CREW_FIRST', 'BALANCED', 'COST_FIRST'] as const) {
        const weights = profile === 'CREW_FIRST'
          ? { fuel: 0.16, rad: 0.32, comm: 0.16, safety: 0.26, time: 0.1 }
          : profile === 'COST_FIRST'
            ? { fuel: 0.28, rad: 0.2, comm: 0.16, safety: 0.2, time: 0.16 }
            : { fuel: 0.2, rad: 0.28, comm: 0.16, safety: 0.24, time: 0.12 };
        const outcome = evaluateCandidate({ weights, shieldingLevel, launchWindow, policy: profile });
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
