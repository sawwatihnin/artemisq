export interface ManeuverTargetingResult {
  deltaVVectorKmS: [number, number, number];
  deltaVMagnitudeKmS: number;
  burnDurationS: number;
  closingVelocityKmS: number;
  estimatedArrivalErrorKm: number;
  targetingQuality: 'GOOD' | 'WATCH' | 'POOR';
  source: string;
}

function mag(v: [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v: [number, number, number], s: number): [number, number, number] {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function designTargetingManeuver(params: {
  currentPositionKm: [number, number, number];
  currentVelocityKmS: [number, number, number];
  targetPositionKm: [number, number, number];
  targetVelocityKmS?: [number, number, number];
  timeToGoHours: number;
  thrustN: number;
  massKg: number;
}): ManeuverTargetingResult {
  const timeToGoS = Math.max(60, params.timeToGoHours * 3600);
  const dr = sub(params.targetPositionKm, params.currentPositionKm);
  const dvDesired = params.targetVelocityKmS ? sub(params.targetVelocityKmS, params.currentVelocityKmS) : [0, 0, 0] as [number, number, number];
  const proportionalCorrection = scale(dr, 1 / timeToGoS);
  const deltaVVectorKmS: [number, number, number] = [
    proportionalCorrection[0] + dvDesired[0],
    proportionalCorrection[1] + dvDesired[1],
    proportionalCorrection[2] + dvDesired[2],
  ];
  const deltaVMagnitudeKmS = mag(deltaVVectorKmS);
  const accelerationKmS2 = Math.max(params.thrustN / Math.max(params.massKg, 1) / 1000, 1e-6);
  const burnDurationS = deltaVMagnitudeKmS / accelerationKmS2;
  const closingVelocityKmS = mag(proportionalCorrection);
  const estimatedArrivalErrorKm = mag(dr) * clamp(burnDurationS / timeToGoS, 0.01, 0.4);
  const targetingQuality =
    estimatedArrivalErrorKm < 5 ? 'GOOD' : estimatedArrivalErrorKm < 25 ? 'WATCH' : 'POOR';

  return {
    deltaVVectorKmS,
    deltaVMagnitudeKmS,
    burnDurationS,
    closingVelocityKmS,
    estimatedArrivalErrorKm,
    targetingQuality,
    source: 'FORMULA-DRIVEN · Impulsive maneuver targeting estimate',
  };
}
