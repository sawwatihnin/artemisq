export interface CouplingParams {
  shieldingMassKg: number;
  launchDelayHours: number;
  replanCount: number;
  baselineDeltaV_ms: number;
  baselineCost: number;
  baselineRadiationRisk: number;
}

export interface CoupledEffectsResult {
  interactions: Array<{
    cause: string;
    effects: string[];
  }>;
  aggregate: {
    deltaVShift_ms: number;
    costShift: number;
    radiationRiskShift: number;
    durationShiftHours: number;
  };
}

export function computeCoupledEffects(params: CouplingParams): CoupledEffectsResult {
  const shieldingDeltaV = params.shieldingMassKg * 0.9;
  const shieldingCost = params.shieldingMassKg * 2400;
  const radiationBenefit = -0.0009 * params.shieldingMassKg;
  const delayBenefit = -0.0035 * params.launchDelayHours;
  const delayCost = params.launchDelayHours * 1800;
  const replanDuration = params.replanCount * 5.5;
  const replanRiskPenalty = params.replanCount * 0.06;

  return {
    interactions: [
      {
        cause: 'increase shielding',
        effects: ['lower radiation', 'higher deltaV', 'higher cost'],
      },
      {
        cause: 'delay launch',
        effects: ['lower radiation', 'higher schedule cost', 'longer mission start latency'],
      },
      {
        cause: 'replan maneuver',
        effects: ['higher duration', 'higher exposure accumulation', 'higher operational cost'],
      },
    ],
    aggregate: {
      deltaVShift_ms: shieldingDeltaV + 35 * params.replanCount,
      costShift: shieldingCost + delayCost + params.baselineCost * replanRiskPenalty * 0.08,
      radiationRiskShift: radiationBenefit + delayBenefit + replanRiskPenalty,
      durationShiftHours: params.launchDelayHours + replanDuration,
    },
  };
}
