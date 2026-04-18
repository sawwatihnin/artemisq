export interface RecommendationHistoryEntry {
  weights?: {
    fuel: number;
    rad: number;
    comm: number;
    safety: number;
    time: number;
  };
  crewRisk: number;
  successProbability: number;
  expectedCost: number;
  shieldingMassKg?: number;
  launchDelayHours?: number;
  policyProfile?: 'CREW_FIRST' | 'BALANCED' | 'COST_FIRST';
}

export interface RecommendationBundle {
  recommendedWeights: {
    fuel: number;
    rad: number;
    comm: number;
    safety: number;
    time: number;
  };
  recommendedPolicy: {
    shieldingMassKg: number;
    launchDelayHours: number;
    profile: 'CREW_FIRST' | 'BALANCED' | 'COST_FIRST';
  };
  rationale: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rankEntry(entry: RecommendationHistoryEntry): number {
  return 1.3 * entry.successProbability - 1.1 * entry.crewRisk - 0.0006 * entry.expectedCost;
}

function topHistory(history: RecommendationHistoryEntry[]): RecommendationHistoryEntry[] {
  const sorted = [...history].sort((a, b) => rankEntry(b) - rankEntry(a));
  return sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
}

export function suggestOptimalWeights(history: RecommendationHistoryEntry[]): RecommendationBundle['recommendedWeights'] {
  const selected = topHistory(history);
  const defaults = { fuel: 0.2, rad: 0.3, comm: 0.16, safety: 0.24, time: 0.1 };

  if (!selected.some((entry) => entry.weights)) return defaults;

  const sum = selected.reduce((acc, entry) => {
    const weights = entry.weights ?? defaults;
    acc.fuel += weights.fuel;
    acc.rad += weights.rad;
    acc.comm += weights.comm;
    acc.safety += weights.safety;
    acc.time += weights.time;
    return acc;
  }, { fuel: 0, rad: 0, comm: 0, safety: 0, time: 0 });

  const count = selected.length;
  return {
    fuel: sum.fuel / count,
    rad: sum.rad / count,
    comm: sum.comm / count,
    safety: sum.safety / count,
    time: sum.time / count,
  };
}

export function suggestShieldingLevel(history: RecommendationHistoryEntry[]): { shieldingMassKg: number; rationale: string } {
  const selected = topHistory(history);
  const averageRisk = selected.reduce((sum, entry) => sum + entry.crewRisk, 0) / Math.max(selected.length, 1);
  const averageShielding = selected.reduce((sum, entry) => sum + (entry.shieldingMassKg ?? 120), 0) / Math.max(selected.length, 1);
  const recommended = clamp(averageShielding + 80 * averageRisk, 60, 420);

  return {
    shieldingMassKg: recommended,
    rationale: averageRisk > 0.7
      ? 'Increase shielding because high-performing historical cases remain radiation-limited.'
      : 'Moderate shielding is sufficient because additional mass would not meaningfully improve the top-performing cases.',
  };
}

export function suggestLaunchPolicy(history: RecommendationHistoryEntry[]): { launchDelayHours: number; profile: 'CREW_FIRST' | 'BALANCED' | 'COST_FIRST'; rationale: string } {
  const selected = topHistory(history);
  const averageRisk = selected.reduce((sum, entry) => sum + entry.crewRisk, 0) / Math.max(selected.length, 1);
  const averageDelay = selected.reduce((sum, entry) => sum + (entry.launchDelayHours ?? 0), 0) / Math.max(selected.length, 1);
  const profile = averageRisk > 0.8 ? 'CREW_FIRST' : averageRisk < 0.45 ? 'BALANCED' : 'CREW_FIRST';

  return {
    launchDelayHours: clamp(averageDelay + (averageRisk > 0.75 ? 6 : 0), 0, 36),
    profile,
    rationale: averageRisk > 0.75
      ? 'A delayed, crew-first launch posture reduces exposure during elevated environmental risk.'
      : 'A balanced launch posture preserves mission value without materially degrading crew safety.',
  };
}

export function buildRecommendations(history: RecommendationHistoryEntry[]): RecommendationBundle {
  const recommendedWeights = suggestOptimalWeights(history);
  const shielding = suggestShieldingLevel(history);
  const launch = suggestLaunchPolicy(history);

  return {
    recommendedWeights,
    recommendedPolicy: {
      shieldingMassKg: shielding.shieldingMassKg,
      launchDelayHours: launch.launchDelayHours,
      profile: launch.profile,
    },
    rationale: [
      shielding.rationale,
      launch.rationale,
      `Recommended weights emphasize radiation ${recommendedWeights.rad.toFixed(2)} and safety ${recommendedWeights.safety.toFixed(2)} relative to fuel ${recommendedWeights.fuel.toFixed(2)}.`,
    ],
  };
}
