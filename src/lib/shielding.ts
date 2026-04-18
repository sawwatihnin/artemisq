const G0 = 9.80665;

export interface ShieldingParams {
  shieldingMassKg: number;
  habitatAreaM2?: number;
  attenuationCoeffPerKgM2?: number;
  maxShieldingFraction?: number;
  spacecraftMassKg: number;
  baseDeltaV_ms: number;
  isp_s?: number;
  massPenaltyCoefficient?: number;
}

export interface ShieldingEffect {
  arealDensityKgM2: number;
  shieldingFactor: number;
  radiationMultiplier: number;
}

export interface MassPenalty {
  massRatio: number;
  deltaVMultiplier: number;
  equivalentPropellantKg: number;
}

export interface ShieldingTradeoff {
  shieldingMassKg: number;
  shieldingFactor: number;
  adjustedRadiation: number;
  adjustedDeltaV_ms: number;
  addedPropellantKg: number;
  valueScore: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeShieldingEffect(
  shieldingMassKg: number,
  params: { habitatAreaM2?: number; attenuationCoeffPerKgM2?: number; maxShieldingFraction?: number } = {},
): ShieldingEffect {
  const habitatAreaM2 = params.habitatAreaM2 ?? 18;
  const attenuationCoeffPerKgM2 = params.attenuationCoeffPerKgM2 ?? 0.018;
  const maxShieldingFraction = params.maxShieldingFraction ?? 0.7;
  const arealDensityKgM2 = shieldingMassKg / Math.max(habitatAreaM2, 0.1);
  const shieldingFactor = clamp(1 - Math.exp(-attenuationCoeffPerKgM2 * arealDensityKgM2), 0, maxShieldingFraction);

  return {
    arealDensityKgM2,
    shieldingFactor,
    radiationMultiplier: 1 - shieldingFactor,
  };
}

export function computeMassPenalty(
  shieldingMassKg: number,
  params: { spacecraftMassKg: number; baseDeltaV_ms: number; isp_s?: number; massPenaltyCoefficient?: number },
): MassPenalty {
  const spacecraftMassKg = Math.max(params.spacecraftMassKg, 1);
  const baseDeltaV_ms = Math.max(params.baseDeltaV_ms, 0);
  const massPenaltyCoefficient = params.massPenaltyCoefficient ?? 0.9;
  const isp_s = params.isp_s ?? 450;
  const massRatio = shieldingMassKg / spacecraftMassKg;
  const deltaVMultiplier = 1 + massPenaltyCoefficient * massRatio;
  const equivalentPropellantKg = spacecraftMassKg * (Math.exp((baseDeltaV_ms * (deltaVMultiplier - 1)) / Math.max(isp_s * G0, 1)) - 1);

  return {
    massRatio,
    deltaVMultiplier,
    equivalentPropellantKg: Math.max(0, equivalentPropellantKg),
  };
}

export function evaluateShieldingTradeoff(
  radiationSamples: Array<{ radiation: number }>,
  params: ShieldingParams,
): ShieldingTradeoff {
  const baselineRadiation = radiationSamples.reduce((sum, sample) => sum + sample.radiation, 0);
  const shielding = computeShieldingEffect(params.shieldingMassKg, params);
  const massPenalty = computeMassPenalty(params.shieldingMassKg, params);
  const adjustedRadiation = baselineRadiation * shielding.radiationMultiplier;
  const adjustedDeltaV_ms = params.baseDeltaV_ms * massPenalty.deltaVMultiplier;
  const riskReduction = Math.max(0, baselineRadiation - adjustedRadiation);
  const addedCost = Math.max(1, adjustedDeltaV_ms - params.baseDeltaV_ms);

  return {
    shieldingMassKg: params.shieldingMassKg,
    shieldingFactor: shielding.shieldingFactor,
    adjustedRadiation,
    adjustedDeltaV_ms,
    addedPropellantKg: massPenalty.equivalentPropellantKg,
    valueScore: riskReduction / addedCost,
  };
}
