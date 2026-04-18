import { MU, RE, type ECIState, keplerian2ECI } from './orbital';

export interface ImportedOrbitalObject {
  id: string;
  name: string;
  source: 'state-vector' | 'tle';
  epoch: string;
  state: ECIState;
  covarianceSigmaKm?: number;
}

export interface GeneratedMissionNode {
  id: string;
  name: string;
  x: number;
  y: number;
  radiation: number;
  commScore: number;
  altitude_km: number;
  inclination: number;
  epoch: string;
  state: ECIState;
  covarianceSigmaKm: number;
}

export interface GeneratedMissionEdge {
  from: string;
  to: string;
  distance: number;
  fuelCost: number;
  deltaV_ms: number;
  transferTime_days: number;
  planeChange_deg: number;
}

export interface ImportedMissionConfig {
  launchBodyId?: string;
  targetBodyId?: string;
  missionType?: 'lunar' | 'orbital' | 'rover';
  fuelType?: 'RP-1' | 'LH2' | 'Methane';
  launchDate?: string;
  launchLatitude?: number;
  launchLongitude?: number;
  launchAltitudeKm?: number;
  spacecraftMass?: number;
  spacecraftThrust?: number;
  orbitalObjects?: ImportedOrbitalObject[];
  tleObjects?: Array<{ id: string; name: string; tle1: string; tle2: string; covarianceSigmaKm?: number }>;
}

export interface ConjunctionAssessment {
  objectA: string;
  objectB: string;
  tcaSeconds: number;
  closestApproachKm: number;
  relativeVelocityKms: number;
  collisionProbability: number;
}

function dot(a: [number, number, number], b: [number, number, number]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function mag(v: [number, number, number]) {
  return Math.sqrt(dot(v, v));
}

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(v: [number, number, number], s: number): [number, number, number] {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function meanAnomalyToTrueAnomaly(meanAnomalyRad: number, eccentricity: number): number {
  let E = meanAnomalyRad;
  for (let i = 0; i < 10; i++) {
    E = E - (E - eccentricity * Math.sin(E) - meanAnomalyRad) / (1 - eccentricity * Math.cos(E));
  }
  return 2 * Math.atan2(
    Math.sqrt(1 + eccentricity) * Math.sin(E / 2),
    Math.sqrt(1 - eccentricity) * Math.cos(E / 2),
  );
}

function parseTleEpoch(line1: string): string {
  const year = Number(line1.slice(18, 20));
  const dayOfYear = Number(line1.slice(20, 32));
  const fullYear = year < 57 ? 2000 + year : 1900 + year;
  if (!Number.isFinite(dayOfYear)) {
    return new Date(Date.UTC(fullYear, 0, 1, 0, 0, 0)).toISOString();
  }
  const epochMs = Date.UTC(fullYear, 0, 1, 0, 0, 0, 0) + (dayOfYear - 1) * 86400000;
  return new Date(epochMs).toISOString();
}

export function parseTleObject(input: { id: string; name: string; tle1: string; tle2: string; covarianceSigmaKm?: number }): ImportedOrbitalObject {
  const line2 = input.tle2;
  const inclination = Number(line2.slice(8, 16));
  const raan = Number(line2.slice(17, 25));
  const eccentricity = Number(`0.${line2.slice(26, 33).trim()}`);
  const argp = Number(line2.slice(34, 42));
  const meanAnomaly = Number(line2.slice(43, 51));
  const meanMotionRevPerDay = Number(line2.slice(52, 63));
  const meanMotionRadPerSec = (meanMotionRevPerDay * 2 * Math.PI) / 86400;
  const semiMajorAxisKm = Math.cbrt(MU / (meanMotionRadPerSec * meanMotionRadPerSec));
  const trueAnomalyDeg = (meanAnomalyToTrueAnomaly((meanAnomaly * Math.PI) / 180, eccentricity) * 180) / Math.PI;

  return {
    id: input.id,
    name: input.name,
    source: 'tle',
    epoch: parseTleEpoch(input.tle1),
    covarianceSigmaKm: input.covarianceSigmaKm ?? 1.5,
    state: keplerian2ECI({
      a: semiMajorAxisKm,
      e: eccentricity,
      i: inclination,
      raan,
      argp,
      nu: trueAnomalyDeg,
    }),
  };
}

function stateToNode(object: ImportedOrbitalObject, index: number, count: number): GeneratedMissionNode {
  const rMag = mag(object.state.r);
  const h = cross(object.state.r, object.state.v);
  const inc = Math.acos(h[2] / Math.max(1e-9, mag(h))) * (180 / Math.PI);
  const altitude = rMag - RE;
  const phase = count > 1 ? index / (count - 1) : 0.5;
  return {
    id: object.id,
    name: object.name,
    x: 10 + phase * 80,
    y: 20 + ((inc % 90) / 90) * 60,
    radiation: Math.min(1, Math.max(0.05, altitude / 45000)),
    commScore: Math.max(0.3, 1 - altitude / 60000),
    altitude_km: altitude,
    inclination: inc,
    epoch: object.epoch,
    state: object.state,
    covarianceSigmaKm: object.covarianceSigmaKm ?? 1.5,
  };
}

export function buildMissionGraphFromImportedConfig(config: ImportedMissionConfig): {
  nodes: GeneratedMissionNode[];
  edges: GeneratedMissionEdge[];
} {
  const imported = [
    ...(config.orbitalObjects ?? []),
    ...((config.tleObjects ?? []).map(parseTleObject)),
  ];

  const nodes = imported.map((object, index) => stateToNode(object, index, imported.length));
  const edges: GeneratedMissionEdge[] = [];

  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const from = nodes[i];
      const to = nodes[j];
      const r1 = RE + from.altitude_km;
      const r2 = RE + to.altitude_km;
      const v1 = Math.sqrt(MU / r1);
      const v2 = Math.sqrt(MU / r2);
      const transferA = (r1 + r2) / 2;
      const vt1 = Math.sqrt(MU * (2 / r1 - 1 / transferA));
      const vt2 = Math.sqrt(MU * (2 / r2 - 1 / transferA));
      const dvHohmann = Math.abs(vt1 - v1) + Math.abs(v2 - vt2);
      const planeChangeRad = Math.abs((to.inclination - from.inclination) * Math.PI / 180);
      const planeChangeDv = 2 * Math.min(v1, v2) * Math.sin(planeChangeRad / 2);
      const totalDv = (dvHohmann + planeChangeDv) * 1000;
      const transferTimeDays = Math.PI * Math.sqrt(Math.pow(transferA, 3) / MU) / 86400;

      if (totalDv <= 4500 && transferTimeDays <= 3) {
        edges.push({
          from: from.id,
          to: to.id,
          distance: Math.abs(to.altitude_km - from.altitude_km),
          fuelCost: totalDv / 100,
          deltaV_ms: totalDv,
          transferTime_days: transferTimeDays,
          planeChange_deg: Math.abs(to.inclination - from.inclination),
        });
      }
    }
  }

  return { nodes, edges };
}

function gravitationalAcceleration(r: [number, number, number]): [number, number, number] {
  const rNorm = Math.max(1e-9, mag(r));
  return scale(r, -MU / (rNorm * rNorm * rNorm));
}

function rk4Step(state: ECIState, dt: number): ECIState {
  const k1r = state.v;
  const k1v = gravitationalAcceleration(state.r);

  const k2r = add(state.v, scale(k1v, dt / 2));
  const k2v = gravitationalAcceleration(add(state.r, scale(k1r, dt / 2)));

  const k3r = add(state.v, scale(k2v, dt / 2));
  const k3v = gravitationalAcceleration(add(state.r, scale(k2r, dt / 2)));

  const k4r = add(state.v, scale(k3v, dt));
  const k4v = gravitationalAcceleration(add(state.r, scale(k3r, dt)));

  return {
    r: add(
      state.r,
      scale(add(add(k1r, scale(add(k2r, k3r), 2)), k4r), dt / 6),
    ),
    v: add(
      state.v,
      scale(add(add(k1v, scale(add(k2v, k3v), 2)), k4v), dt / 6),
    ),
  };
}

function propagateStateForDuration(state: ECIState, durationSec: number, dtCap: number): ECIState {
  if (durationSec <= 0 || !Number.isFinite(durationSec)) return state;
  let s = state;
  let remaining = durationSec;
  while (remaining > 1e-9) {
    const h = Math.min(dtCap, remaining);
    s = rk4Step(s, h);
    remaining -= h;
  }
  return s;
}

export function assessConjunction(
  a: GeneratedMissionNode,
  b: GeneratedMissionNode,
  horizonSeconds = 86400,
  dtSeconds = 120,
): ConjunctionAssessment {
  const epochAMs = Date.parse(a.epoch);
  const epochBMs = Date.parse(b.epoch);
  const tRefMs = Math.max(
    Number.isFinite(epochAMs) ? epochAMs : 0,
    Number.isFinite(epochBMs) ? epochBMs : 0,
  );
  const secA = Number.isFinite(epochAMs) && tRefMs > 0 ? (tRefMs - epochAMs) / 1000 : 0;
  const secB = Number.isFinite(epochBMs) && tRefMs > 0 ? (tRefMs - epochBMs) / 1000 : 0;

  let stateA = propagateStateForDuration(a.state, secA, dtSeconds);
  let stateB = propagateStateForDuration(b.state, secB, dtSeconds);
  let bestTime = 0;
  let bestDistance = Infinity;
  let bestRelVelocity = 0;

  for (let t = 0; t <= horizonSeconds; t += dtSeconds) {
    const relR = sub(stateA.r, stateB.r);
    const relV = sub(stateA.v, stateB.v);
    const distance = mag(relR);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTime = t;
      bestRelVelocity = mag(relV);
    }
    stateA = rk4Step(stateA, dtSeconds);
    stateB = rk4Step(stateB, dtSeconds);
  }

  const sigma = Math.max(0.1, Math.sqrt(a.covarianceSigmaKm ** 2 + b.covarianceSigmaKm ** 2));
  const collisionProbability = Math.exp(-(bestDistance * bestDistance) / (2 * sigma * sigma));

  return {
    objectA: a.name,
    objectB: b.name,
    tcaSeconds: bestTime,
    closestApproachKm: bestDistance,
    relativeVelocityKms: bestRelVelocity,
    collisionProbability,
  };
}
