export interface VOIAction {
  name: string;
  expectedUtility: number;
}

export interface VOIDataBranch {
  probability: number;
  bestUtilityAfterObservation: number;
}

export interface VOIResult {
  valueOfWaiting: number;
  recommendation: string;
}

export function computeVOI(
  currentDecision: VOIAction,
  potentialData: VOIDataBranch[],
): VOIResult {
  const expectedUtilityWithData = potentialData.reduce((sum, branch) => sum + branch.probability * branch.bestUtilityAfterObservation, 0);
  const valueOfWaiting = expectedUtilityWithData - currentDecision.expectedUtility;
  return {
    valueOfWaiting,
    recommendation: valueOfWaiting > 0
      ? `Wait for additional information because it adds expected utility ${valueOfWaiting.toFixed(2)}.`
      : 'Act now because additional data does not improve expected utility enough to justify delay.',
  };
}
