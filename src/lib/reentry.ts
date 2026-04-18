export interface ReentryParams {
  approachVelocityMs: number;
  flightPathAngleDeg: number;
  safeAngleMinDeg?: number;
  safeAngleMaxDeg?: number;
  safeVelocityMinMs?: number;
  safeVelocityMaxMs?: number;
}

export interface ReentryEvaluation {
  reentrySafe: boolean;
  reentryRiskScore: number;
  violationReason?: string;
  approachVelocityMs: number;
  flightPathAngleDeg: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function evaluateReentry(
  _path: string[],
  params: ReentryParams,
): ReentryEvaluation {
  const safeAngleMinDeg = params.safeAngleMinDeg ?? -7.5;
  const safeAngleMaxDeg = params.safeAngleMaxDeg ?? -5.5;
  const safeVelocityMinMs = params.safeVelocityMinMs ?? 10800;
  const safeVelocityMaxMs = params.safeVelocityMaxMs ?? 11350;

  const angleViolation = params.flightPathAngleDeg < safeAngleMinDeg
    ? safeAngleMinDeg - params.flightPathAngleDeg
    : params.flightPathAngleDeg > safeAngleMaxDeg
      ? params.flightPathAngleDeg - safeAngleMaxDeg
      : 0;
  const velocityViolation = params.approachVelocityMs < safeVelocityMinMs
    ? safeVelocityMinMs - params.approachVelocityMs
    : params.approachVelocityMs > safeVelocityMaxMs
      ? params.approachVelocityMs - safeVelocityMaxMs
      : 0;

  const reentryRiskScore = clamp(
    100 * (0.55 * Math.min(angleViolation / 2, 1) + 0.45 * Math.min(velocityViolation / 1200, 1)),
    0,
    100,
  );

  let violationReason: string | undefined;
  if (angleViolation > 0 && velocityViolation > 0) {
    violationReason = 'Flight-path angle and entry velocity both fall outside the nominal corridor.';
  } else if (angleViolation > 0) {
    violationReason = 'Flight-path angle falls outside the nominal reentry corridor.';
  } else if (velocityViolation > 0) {
    violationReason = 'Approach velocity falls outside the nominal reentry envelope.';
  }

  return {
    reentrySafe: angleViolation === 0 && velocityViolation === 0,
    reentryRiskScore,
    violationReason,
    approachVelocityMs: params.approachVelocityMs,
    flightPathAngleDeg: params.flightPathAngleDeg,
  };
}
