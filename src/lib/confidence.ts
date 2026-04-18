export interface MissionConfidenceInput {
  crewRiskScore: number;
  expectedCost: number;
  costVariance: number;
  successProbability: number;
  feasibility: number;
}

export interface MissionConfidence {
  confidenceScore: number;
  interpretation: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeMissionConfidence(input: MissionConfidenceInput): MissionConfidence {
  const normalizedRisk = 1 - clamp(input.crewRiskScore / 1.5, 0, 1);
  const normalizedVariance = 1 - clamp(input.costVariance / Math.max(input.expectedCost ** 2, 1), 0, 1);
  const normalizedCost = 1 - clamp(input.expectedCost / 1_000_000_000, 0, 1);
  const confidenceScore = clamp(
    100 * (
      0.35 * normalizedRisk +
      0.2 * normalizedVariance +
      0.2 * clamp(input.successProbability, 0, 1) +
      0.15 * clamp(input.feasibility, 0, 1) +
      0.1 * normalizedCost
    ),
    0,
    100,
  );

  const interpretation = confidenceScore >= 80
    ? 'High confidence mission posture.'
    : confidenceScore >= 60
      ? 'Moderate confidence with manageable operational uncertainty.'
      : confidenceScore >= 40
        ? 'Low confidence; major risk or cost drivers remain active.'
        : 'Very low confidence; mission should be reconsidered before commitment.';

  return {
    confidenceScore,
    interpretation,
  };
}
