export type ConstraintType = 'COMM_BLACKOUT' | 'RADIATION_THRESHOLD' | 'RETURN_MARGIN';

export interface RelaxationParams {
  communicationBlackoutMinutes?: number;
  radiationThreshold?: number;
  returnFeasibilityFloor?: number;
}

export interface RelaxationImpactInput {
  baselineRisk: number;
  baselineCost: number;
  baselineCommunication: number;
  baselineDurationHours: number;
  relaxedConstraint: ConstraintType;
  params: RelaxationParams;
}

export interface ConstraintRelaxationResult {
  relaxedConstraint: ConstraintType;
  benefit: number;
  cost: number;
  recommendation: string;
  updatedParams: RelaxationParams;
}

export function relaxConstraint(params: RelaxationParams, constraintType: ConstraintType): ConstraintRelaxationResult {
  if (constraintType === 'COMM_BLACKOUT') {
    const minutes = Math.max(10, (params.communicationBlackoutMinutes ?? 0) + 20);
    return {
      relaxedConstraint: constraintType,
      benefit: 0.18,
      cost: 0.08,
      recommendation: 'Permit a short communication blackout only when it unlocks a materially safer corridor.',
      updatedParams: { ...params, communicationBlackoutMinutes: minutes },
    };
  }

  if (constraintType === 'RADIATION_THRESHOLD') {
    const threshold = (params.radiationThreshold ?? 0.78) * 1.08;
    return {
      relaxedConstraint: constraintType,
      benefit: 0.12,
      cost: 0.22,
      recommendation: 'Relax radiation limits only for brief transients and only with crew sheltering available.',
      updatedParams: { ...params, radiationThreshold: threshold },
    };
  }

  return {
    relaxedConstraint: constraintType,
    benefit: 0.1,
    cost: 0.16,
    recommendation: 'Lower return-feasibility margins only if abort geometry remains continuously reachable.',
    updatedParams: {
      ...params,
      returnFeasibilityFloor: Math.max(0.35, (params.returnFeasibilityFloor ?? 0.55) - 0.08),
    },
  };
}

export function evaluateRelaxationImpact(path: RelaxationImpactInput): ConstraintRelaxationResult {
  const relaxed = relaxConstraint(path.params, path.relaxedConstraint);
  const communicationLeverage = 1 - path.baselineCommunication;
  const durationPenalty = path.baselineDurationHours / 240;

  const benefit = relaxed.benefit + (path.relaxedConstraint === 'COMM_BLACKOUT' ? 0.12 * communicationLeverage : 0.05);
  const cost = relaxed.cost + 0.1 * path.baselineRisk + 0.06 * durationPenalty + 0.00015 * path.baselineCost;

  return {
    ...relaxed,
    benefit,
    cost,
    recommendation: benefit > cost
      ? relaxed.recommendation
      : `Do not relax ${path.relaxedConstraint.toLowerCase().replace('_', ' ')} because the operational penalty exceeds the gained flexibility.`,
  };
}
