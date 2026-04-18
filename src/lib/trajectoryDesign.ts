import { AU_KM, CELESTIAL_BODY_MAP } from './celestial';

export interface LambertSolution {
  v1KmS: [number, number, number];
  v2KmS: [number, number, number];
  departureSpeedKmS: number;
  arrivalSpeedKmS: number;
  c3Km2S2: number;
  solved: boolean;
  iterations: number;
}

export interface PatchedConicEstimate {
  departureVinfKmS: number;
  arrivalVinfKmS: number;
  departureDeltaVKmS: number;
  arrivalDeltaVKmS: number;
  totalDeltaVKmS: number;
}

export interface PhasingPlan {
  bestDelayHours: number;
  targetPhaseAngleDeg: number;
  achievedPhaseAngleDeg: number;
  residualDeg: number;
  synodicPeriodDays: number;
}

export interface GravityAssistSequenceCandidate {
  sequence: string[];
  score: number;
  estimatedDeltaVGainKmS: number;
  estimatedTimeDays: number;
}

export interface AbortBranch {
  label: string;
  branchType: 'FREE_RETURN' | 'DIRECT_RETURN' | 'SAFE_HAVEN';
  deltaVKmS: number;
  timeToRecoveryDays: number;
  riskModifier: number;
}

export interface ReservePolicy {
  propellantReservePct: number;
  reserveDeltaVKmS: number;
  nominalDeltaVKmS: number;
  contingencyDeltaVKmS: number;
  rationale: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mag(v: [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function scale(v: [number, number, number], s: number): [number, number, number] {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function stumpffC(z: number): number {
  if (z > 0) {
    const sz = Math.sqrt(z);
    return (1 - Math.cos(sz)) / z;
  }
  if (z < 0) {
    const sz = Math.sqrt(-z);
    return (Math.cosh(sz) - 1) / (-z);
  }
  return 0.5;
}

function stumpffS(z: number): number {
  if (z > 0) {
    const sz = Math.sqrt(z);
    return (sz - Math.sin(sz)) / (sz * sz * sz);
  }
  if (z < 0) {
    const sz = Math.sqrt(-z);
    return (Math.sinh(sz) - sz) / (sz * sz * sz);
  }
  return 1 / 6;
}

function transferAngle(r1: [number, number, number], r2: [number, number, number], prograde = true): number {
  const c = cross(r1, r2);
  const cosNu = clamp(dot(r1, r2) / Math.max(1e-12, mag(r1) * mag(r2)), -1, 1);
  let nu = Math.acos(cosNu);
  if (prograde ? c[2] < 0 : c[2] >= 0) nu = 2 * Math.PI - nu;
  return nu;
}

export function solveLambertUniversal(params: {
  r1Km: [number, number, number];
  r2Km: [number, number, number];
  tofSec: number;
  muKm3S2: number;
  prograde?: boolean;
}): LambertSolution {
  const { r1Km, r2Km, tofSec, muKm3S2 } = params;
  const r1 = mag(r1Km);
  const r2 = mag(r2Km);
  const dNu = transferAngle(r1Km, r2Km, params.prograde ?? true);
  const A = Math.sin(dNu) * Math.sqrt((r1 * r2) / Math.max(1e-12, 1 - Math.cos(dNu)));
  if (!Number.isFinite(A) || Math.abs(A) < 1e-9) {
    return {
      v1KmS: [0, 0, 0],
      v2KmS: [0, 0, 0],
      departureSpeedKmS: 0,
      arrivalSpeedKmS: 0,
      c3Km2S2: 0,
      solved: false,
      iterations: 0,
    };
  }

  let z = 0;
  let iterations = 0;
  let y = 0;
  for (; iterations < 80; iterations++) {
    const C = stumpffC(z);
    const S = stumpffS(z);
    y = r1 + r2 + (A * (z * S - 1)) / Math.sqrt(Math.max(C, 1e-12));
    if (A > 0 && y < 0) {
      z += 0.1;
      continue;
    }
    const x = Math.sqrt(Math.max(y / Math.max(C, 1e-12), 0));
    const tof = (x * x * x * S + A * Math.sqrt(Math.max(y, 0))) / Math.sqrt(muKm3S2);
    const error = tof - tofSec;
    if (Math.abs(error) < 1e-3) break;
    const dz = 1e-5;
    const Cp = stumpffC(z + dz);
    const Sp = stumpffS(z + dz);
    const yp = r1 + r2 + (A * ((z + dz) * Sp - 1)) / Math.sqrt(Math.max(Cp, 1e-12));
    const xp = Math.sqrt(Math.max(yp / Math.max(Cp, 1e-12), 0));
    const tofp = (xp * xp * xp * Sp + A * Math.sqrt(Math.max(yp, 0))) / Math.sqrt(muKm3S2);
    const dtdz = (tofp - tof) / dz;
    z -= error / Math.max(Math.abs(dtdz), 1e-8) * Math.sign(dtdz || 1);
    z = clamp(z, -40, 40);
  }

  const f = 1 - y / r1;
  const g = A * Math.sqrt(y / muKm3S2);
  const gdot = 1 - y / r2;
  const v1KmS = scale(sub(r2Km, scale(r1Km, f)), 1 / Math.max(Math.abs(g), 1e-9));
  const v2KmS = scale(sub(scale(r2Km, gdot), r1Km), 1 / Math.max(Math.abs(g), 1e-9));
  const departureSpeedKmS = mag(v1KmS);
  const arrivalSpeedKmS = mag(v2KmS);

  return {
    v1KmS,
    v2KmS,
    departureSpeedKmS,
    arrivalSpeedKmS,
    c3Km2S2: departureSpeedKmS * departureSpeedKmS,
    solved: Number.isFinite(departureSpeedKmS) && Number.isFinite(arrivalSpeedKmS),
    iterations,
  };
}

export function estimatePatchedConicTransfer(params: {
  lambert: LambertSolution;
  departureBodyMuKm3S2: number;
  arrivalBodyMuKm3S2: number;
  departureParkingRadiusKm: number;
  arrivalParkingRadiusKm: number;
}): PatchedConicEstimate {
  const vCirc1 = Math.sqrt(params.departureBodyMuKm3S2 / params.departureParkingRadiusKm);
  const vEsc1 = Math.sqrt(2 * params.departureBodyMuKm3S2 / params.departureParkingRadiusKm + params.lambert.departureSpeedKmS ** 2);
  const departureDeltaVKmS = Math.max(0, vEsc1 - vCirc1);
  const vCirc2 = Math.sqrt(params.arrivalBodyMuKm3S2 / params.arrivalParkingRadiusKm);
  const vCap2 = Math.sqrt(2 * params.arrivalBodyMuKm3S2 / params.arrivalParkingRadiusKm + params.lambert.arrivalSpeedKmS ** 2);
  const arrivalDeltaVKmS = Math.max(0, vCap2 - vCirc2);

  return {
    departureVinfKmS: params.lambert.departureSpeedKmS,
    arrivalVinfKmS: params.lambert.arrivalSpeedKmS,
    departureDeltaVKmS,
    arrivalDeltaVKmS,
    totalDeltaVKmS: departureDeltaVKmS + arrivalDeltaVKmS,
  };
}

export function optimizePlaneChangeAndPhasing(params: {
  fromInclinationDeg: number;
  toInclinationDeg: number;
  orbitalSpeedKmS: number;
  currentPhaseAngleDeg: number;
  targetPhaseAngleDeg: number;
  originPeriodDays: number;
  targetPeriodDays: number;
}): PhasingPlan {
  const synodicPeriodDays = Math.abs(1 / ((1 / params.originPeriodDays) - (1 / params.targetPeriodDays)));
  let bestDelayHours = 0;
  let bestResidual = Number.POSITIVE_INFINITY;

  for (let h = 0; h <= synodicPeriodDays * 24; h += 6) {
    const advanced = params.currentPhaseAngleDeg + (360 * h) / (synodicPeriodDays * 24);
    const residual = Math.abs((((advanced - params.targetPhaseAngleDeg) % 360) + 540) % 360 - 180);
    if (residual < bestResidual) {
      bestResidual = residual;
      bestDelayHours = h;
    }
  }

  return {
    bestDelayHours,
    targetPhaseAngleDeg: params.targetPhaseAngleDeg,
    achievedPhaseAngleDeg: params.currentPhaseAngleDeg + (360 * bestDelayHours) / (synodicPeriodDays * 24),
    residualDeg: bestResidual,
    synodicPeriodDays,
  };
}

export function sequenceGravityAssists(params: {
  originId: string;
  destinationId: string;
  candidates: string[];
}): GravityAssistSequenceCandidate[] {
  const origin = CELESTIAL_BODY_MAP[params.originId];
  const destination = CELESTIAL_BODY_MAP[params.destinationId];
  if (!origin?.orbit || !destination?.orbit) return [];
  const sequences: GravityAssistSequenceCandidate[] = [];

  const unique = [...new Set(params.candidates)].filter((id) => CELESTIAL_BODY_MAP[id]?.orbit);
  for (const assist of unique) {
    const body = CELESTIAL_BODY_MAP[assist];
    if (!body?.orbit) continue;
    const radiusProgress = Math.abs(body.orbit.semiMajorAxisAu - origin.orbit.semiMajorAxisAu) + Math.abs(destination.orbit.semiMajorAxisAu - body.orbit.semiMajorAxisAu);
    const alignmentPenalty = Math.abs(body.orbit.inclinationDeg - destination.orbit.inclinationDeg) * 0.02;
    const gain = Math.sqrt(body.muKm3s2 / 1e5) * 0.35;
    sequences.push({
      sequence: [params.originId, assist, params.destinationId],
      score: gain - 0.08 * radiusProgress - alignmentPenalty,
      estimatedDeltaVGainKmS: gain,
      estimatedTimeDays: radiusProgress * 120,
    });
  }

  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const a = CELESTIAL_BODY_MAP[unique[i]];
      const b = CELESTIAL_BODY_MAP[unique[j]];
      if (!a?.orbit || !b?.orbit) continue;
      const gain = Math.sqrt(a.muKm3s2 / 1e5) * 0.28 + Math.sqrt(b.muKm3s2 / 1e5) * 0.28;
      const radiusProgress =
        Math.abs(a.orbit.semiMajorAxisAu - origin.orbit.semiMajorAxisAu) +
        Math.abs(b.orbit.semiMajorAxisAu - a.orbit.semiMajorAxisAu) +
        Math.abs(destination.orbit.semiMajorAxisAu - b.orbit.semiMajorAxisAu);
      sequences.push({
        sequence: [params.originId, unique[i], unique[j], params.destinationId],
        score: gain - 0.06 * radiusProgress,
        estimatedDeltaVGainKmS: gain,
        estimatedTimeDays: radiusProgress * 150,
      });
    }
  }

  return sequences.sort((a, b) => b.score - a.score).slice(0, 6);
}

export function buildAbortTrajectoryBranches(params: {
  currentDistanceKm: number;
  currentSpeedKmS: number;
  returnBodyMuKm3S2: number;
}): AbortBranch[] {
  const directReturnTimeDays = params.currentDistanceKm / Math.max(params.currentSpeedKmS * 86400, 1);
  return [
    {
      label: 'Free-return coast',
      branchType: 'FREE_RETURN',
      deltaVKmS: 0.18 + 0.0000012 * params.currentDistanceKm,
      timeToRecoveryDays: directReturnTimeDays * 1.08,
      riskModifier: -0.12,
    },
    {
      label: 'Direct return burn',
      branchType: 'DIRECT_RETURN',
      deltaVKmS: 0.45 + Math.sqrt(params.returnBodyMuKm3S2 / Math.max(params.currentDistanceKm, 1)) * 0.3,
      timeToRecoveryDays: directReturnTimeDays * 0.72,
      riskModifier: -0.18,
    },
    {
      label: 'Safe-haven loiter',
      branchType: 'SAFE_HAVEN',
      deltaVKmS: 0.12,
      timeToRecoveryDays: directReturnTimeDays * 1.35,
      riskModifier: -0.06,
    },
  ];
}

export function computeReservePolicy(params: {
  nominalDeltaVKmS: number;
  contingencyDeltaVKmS: number;
  missionDurationDays: number;
  radiationIndex: number;
  crewed?: boolean;
}): ReservePolicy {
  const baseReservePct = params.crewed ? 14 : 8;
  const durationTerm = clamp(params.missionDurationDays / 120, 0, 0.12);
  const environmentTerm = clamp((params.radiationIndex - 1) * 0.04, 0, 0.12);
  const contingencyTerm = params.contingencyDeltaVKmS / Math.max(params.nominalDeltaVKmS, 0.1) * 0.25;
  const propellantReservePct = clamp((baseReservePct / 100) + durationTerm + environmentTerm + contingencyTerm, 0.08, 0.32);
  const reserveDeltaVKmS = params.nominalDeltaVKmS * propellantReservePct;

  return {
    propellantReservePct: propellantReservePct * 100,
    reserveDeltaVKmS,
    nominalDeltaVKmS: params.nominalDeltaVKmS,
    contingencyDeltaVKmS: params.contingencyDeltaVKmS,
    rationale: `Reserve includes base policy ${baseReservePct}% plus duration/environment/contingency terms for a total of ${(propellantReservePct * 100).toFixed(1)}%.`,
  };
}

export function solveLaunchWindowsWithConstraints(params: {
  transferDays: number;
  deltaVKmS: number;
  weatherWindKmh: number;
  precipitationMm: number;
  radiationIndex: number;
  dsnCoverage: number;
  offsetsHours: number[];
}): Array<{
  offsetHours: number;
  score: number;
  weatherPenalty: number;
  radiationPenalty: number;
  commPenalty: number;
}> {
  return params.offsetsHours.map((offsetHours) => {
    const phasePenalty = Math.abs(Math.sin((2 * Math.PI * offsetHours) / 24)) * 0.12;
    const weatherPenalty = clamp(params.weatherWindKmh / 80 + params.precipitationMm / 6, 0, 2);
    const radiationPenalty = clamp((params.radiationIndex - 1) * 0.7 + phasePenalty, 0, 2);
    const commPenalty = clamp((1 - params.dsnCoverage) * 1.2 + 0.08 * (offsetHours / 24), 0, 2);
    const score = 0.4 * params.deltaVKmS + 0.22 * params.transferDays / 100 + 0.18 * weatherPenalty + 0.12 * radiationPenalty + 0.08 * commPenalty;
    return {
      offsetHours,
      score,
      weatherPenalty,
      radiationPenalty,
      commPenalty,
    };
  }).sort((a, b) => a.score - b.score);
}

export function inferBodyParkingRadiusKm(bodyId: string, altitudeKm: number): number {
  const body = CELESTIAL_BODY_MAP[bodyId] ?? CELESTIAL_BODY_MAP.earth;
  return body.radiusKm + altitudeKm;
}

export function inferTransferTimeDaysFromDistance(distanceKm: number, meanSpeedKmS = 22): number {
  return distanceKm / Math.max(meanSpeedKmS * 86400, 1);
}

export function auToKm(au: number): number {
  return au * AU_KM;
}
