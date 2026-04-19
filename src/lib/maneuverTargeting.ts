export interface ManeuverTargetingResult {
  deltaVVectorKmS: [number, number, number];
  deltaVMagnitudeKmS: number;
  burnDurationS: number;
  propellantConsumedKg: number;
  propellantFractionPct: number;
  ignitionAccelerationMs2: number;
  burnoutAccelerationMs2: number;
  closingVelocityKmS: number;
  estimatedArrivalErrorKm: number;
  estimatedArrivalTimeErrorS: number;
  finiteBurnSamples: Array<{
    timeS: number;
    cumulativeDeltaVKmS: number;
    massKg: number;
    accelerationMs2: number;
  }>;
  dispersionCases: Array<{
    label: 'LOW_SIGMA' | 'NOMINAL' | 'HIGH_SIGMA';
    thrustScale: number;
    pointingErrorDeg: number;
    timingOffsetS: number;
    deltaVDeliveredKmS: number;
    estimatedMissDistanceKm: number;
  }>;
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

function normalize(v: [number, number, number]): [number, number, number] {
  const magnitude = mag(v);
  if (magnitude < 1e-9) return [1, 0, 0];
  return [v[0] / magnitude, v[1] / magnitude, v[2] / magnitude];
}

function rotateAboutZ(v: [number, number, number], angleRad: number): [number, number, number] {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [
    v[0] * c - v[1] * s,
    v[0] * s + v[1] * c,
    v[2],
  ];
}

const G0_MS2 = 9.80665;

export function designTargetingManeuver(params: {
  currentPositionKm: [number, number, number];
  currentVelocityKmS: [number, number, number];
  targetPositionKm: [number, number, number];
  targetVelocityKmS?: [number, number, number];
  timeToGoHours: number;
  thrustN: number;
  massKg: number;
  ispS?: number;
  thrustDispersionPct?: number;
  pointingSigmaDeg?: number;
  timingSigmaS?: number;
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
  const ispS = Math.max(150, Number(params.ispS ?? 452));
  const initialMassKg = Math.max(params.massKg, 1);
  const exhaustVelocityMs = ispS * G0_MS2;
  const deltaVMs = deltaVMagnitudeKmS * 1000;
  const massRatio = Math.exp(deltaVMs / exhaustVelocityMs);
  const finalMassKg = initialMassKg / massRatio;
  const propellantConsumedKg = clamp(initialMassKg - finalMassKg, 0, initialMassKg * 0.92);
  const massFlowKgS = Math.max(params.thrustN / exhaustVelocityMs, 1e-6);
  const burnDurationS = Math.max(propellantConsumedKg / massFlowKgS, 0.5);
  const ignitionAccelerationMs2 = params.thrustN / initialMassKg;
  const burnoutAccelerationMs2 = params.thrustN / Math.max(finalMassKg, initialMassKg * 0.08);
  const closingVelocityKmS = mag(proportionalCorrection);
  const thrustDispersionPct = clamp(Number(params.thrustDispersionPct ?? 3), 0, 25);
  const pointingSigmaDeg = clamp(Number(params.pointingSigmaDeg ?? 0.35), 0, 15);
  const timingSigmaS = clamp(Number(params.timingSigmaS ?? 2.5), 0, 900);
  const finiteBurnPenalty = clamp(burnDurationS / timeToGoS, 0.005, 0.28);
  const dispersionPenalty =
    0.45 * mag(dr) * (thrustDispersionPct / 100) +
    0.22 * closingVelocityKmS * timingSigmaS +
    0.12 * deltaVMagnitudeKmS * 1000 * (pointingSigmaDeg / 57.3);
  const estimatedArrivalErrorKm = Math.max(0.5, mag(dr) * finiteBurnPenalty + dispersionPenalty);
  const estimatedArrivalTimeErrorS = timingSigmaS + burnDurationS * (thrustDispersionPct / 100) * 0.4;
  const burnDirection = normalize(deltaVVectorKmS);
  const finiteBurnSamples = Array.from({ length: 6 }, (_, index) => {
    const progress = index / 5;
    const sampleTimeS = burnDurationS * progress;
    const sampleMassKg = initialMassKg - propellantConsumedKg * progress;
    const sampleAccelerationMs2 = params.thrustN / Math.max(sampleMassKg, 1);
    return {
      timeS: sampleTimeS,
      cumulativeDeltaVKmS: deltaVMagnitudeKmS * progress,
      massKg: sampleMassKg,
      accelerationMs2: sampleAccelerationMs2,
    };
  });
  const dispersionCases = [
    { label: 'LOW_SIGMA' as const, thrustScale: 1 - thrustDispersionPct / 200, pointingErrorDeg: pointingSigmaDeg * 0.5, timingOffsetS: -timingSigmaS * 0.5 },
    { label: 'NOMINAL' as const, thrustScale: 1, pointingErrorDeg: 0, timingOffsetS: 0 },
    { label: 'HIGH_SIGMA' as const, thrustScale: 1 + thrustDispersionPct / 100, pointingErrorDeg: pointingSigmaDeg, timingOffsetS: timingSigmaS },
  ].map((scenario) => {
    const steeredDirection = rotateAboutZ(burnDirection, (scenario.pointingErrorDeg * Math.PI) / 180);
    const deliveredVector = scale(steeredDirection, deltaVMagnitudeKmS * scenario.thrustScale);
    const deliveryLossKmS = mag(sub(deliveredVector, deltaVVectorKmS));
    const timingMissKm = Math.max(0, Math.abs(scenario.timingOffsetS) * closingVelocityKmS);
    const burnMissKm = deliveryLossKmS * timeToGoS * 0.12;
    return {
      ...scenario,
      deltaVDeliveredKmS: mag(deliveredVector),
      estimatedMissDistanceKm: Math.max(0.25, timingMissKm + burnMissKm),
    };
  });
  const targetingQuality =
    estimatedArrivalErrorKm < 5 ? 'GOOD' : estimatedArrivalErrorKm < 25 ? 'WATCH' : 'POOR';

  return {
    deltaVVectorKmS,
    deltaVMagnitudeKmS,
    burnDurationS,
    propellantConsumedKg,
    propellantFractionPct: (propellantConsumedKg / initialMassKg) * 100,
    ignitionAccelerationMs2,
    burnoutAccelerationMs2,
    closingVelocityKmS,
    estimatedArrivalErrorKm,
    estimatedArrivalTimeErrorS,
    finiteBurnSamples,
    dispersionCases,
    targetingQuality,
    source: 'FORMULA-DRIVEN · Finite-burn maneuver targeting with dispersion envelope',
  };
}
