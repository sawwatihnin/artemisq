export interface RegretInput {
  expectedRisk: number;
  expectedCost: number;
  successProbability: number;
}

export interface RegretResult {
  regretScore: number;
  missedOpportunity: string;
}

function utility(input: RegretInput): number {
  return 100 * input.successProbability - 85 * input.expectedRisk - 0.0000015 * input.expectedCost;
}

export function computeRegret(chosen: RegretInput, optimal: RegretInput): RegretResult {
  const regretScore = Math.max(0, utility(optimal) - utility(chosen));
  return {
    regretScore,
    missedOpportunity: regretScore > 0
      ? `The chosen action left ${regretScore.toFixed(2)} utility units on the table relative to the best available alternative.`
      : 'No material missed opportunity was detected relative to the benchmark option.',
  };
}
