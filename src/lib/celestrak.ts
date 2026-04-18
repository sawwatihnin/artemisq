import { keplerian2ECI, MU, RE, type ECIState } from './orbital';
import { assessConjunction, type ConjunctionAssessment, type GeneratedMissionNode } from './missionPlanner';

const CELESTRAK_BASE = 'https://celestrak.org/NORAD/elements/gp.php';

export interface CelestrakOmmRecord {
  OBJECT_NAME?: string;
  OBJECT_ID?: string;
  NORAD_CAT_ID?: string | number;
  EPOCH?: string;
  MEAN_MOTION?: number | string;
  ECCENTRICITY?: number | string;
  INCLINATION?: number | string;
  RA_OF_ASC_NODE?: number | string;
  ARG_OF_PERICENTER?: number | string;
  MEAN_ANOMALY?: number | string;
}

export interface CelestrakTrafficAssessment {
  records: CelestrakOmmRecord[];
  nodes: GeneratedMissionNode[];
  conjunctions: ConjunctionAssessment[];
  source: string;
}

function num(value: number | string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function meanMotionToSemiMajorAxisKm(meanMotionRevPerDay: number): number {
  const meanMotionRadPerSec = (meanMotionRevPerDay * 2 * Math.PI) / 86400;
  return Math.cbrt(MU / Math.max(meanMotionRadPerSec * meanMotionRadPerSec, 1e-12));
}

function meanAnomalyToTrueAnomalyDeg(meanAnomalyDeg: number, eccentricity: number): number {
  const M = (meanAnomalyDeg * Math.PI) / 180;
  let E = M;
  for (let i = 0; i < 10; i++) {
    E -= (E - eccentricity * Math.sin(E) - M) / Math.max(1e-9, 1 - eccentricity * Math.cos(E));
  }
  return 2 * Math.atan2(
    Math.sqrt(1 + eccentricity) * Math.sin(E / 2),
    Math.sqrt(1 - eccentricity) * Math.cos(E / 2),
  ) * (180 / Math.PI);
}

function stateMagnitude(state: ECIState): number {
  return Math.hypot(state.r[0], state.r[1], state.r[2]);
}

function inclinationFromState(state: ECIState): number {
  const hx = state.r[1] * state.v[2] - state.r[2] * state.v[1];
  const hy = state.r[2] * state.v[0] - state.r[0] * state.v[2];
  const hz = state.r[0] * state.v[1] - state.r[1] * state.v[0];
  return Math.acos(hz / Math.max(1e-9, Math.hypot(hx, hy, hz))) * (180 / Math.PI);
}

function recordToNode(record: CelestrakOmmRecord, index: number, count: number): GeneratedMissionNode | null {
  const meanMotion = num(record.MEAN_MOTION);
  const eccentricity = num(record.ECCENTRICITY);
  const inclination = num(record.INCLINATION);
  const raan = num(record.RA_OF_ASC_NODE);
  const argp = num(record.ARG_OF_PERICENTER);
  const meanAnomaly = num(record.MEAN_ANOMALY);
  if (!(meanMotion > 0)) return null;

  const state = keplerian2ECI({
    a: meanMotionToSemiMajorAxisKm(meanMotion),
    e: eccentricity,
    i: inclination,
    raan,
    argp,
    nu: meanAnomalyToTrueAnomalyDeg(meanAnomaly, eccentricity),
  });
  const altitude = stateMagnitude(state) - RE;
  const phase = count > 1 ? index / (count - 1) : 0.5;
  return {
    id: String(record.NORAD_CAT_ID ?? record.OBJECT_ID ?? index),
    name: record.OBJECT_NAME ?? `Object ${index + 1}`,
    x: 10 + phase * 80,
    y: 20 + ((inclinationFromState(state) % 90) / 90) * 60,
    radiation: Math.min(1, Math.max(0.05, altitude / 45000)),
    commScore: Math.max(0.25, 1 - altitude / 70000),
    altitude_km: altitude,
    inclination: inclinationFromState(state),
    epoch: record.EPOCH ?? new Date().toISOString(),
    state,
    covarianceSigmaKm: 1.5,
  };
}

export async function fetchCelestrakGp(params: {
  group?: string;
  name?: string;
  catnr?: string | number;
  format?: 'JSON' | 'CSV' | 'XML' | 'TLE' | '3LE' | '2LE';
}): Promise<CelestrakOmmRecord[]> {
  const url = new URL(CELESTRAK_BASE);
  const format = params.format ?? 'JSON';
  if (params.group) url.searchParams.set('GROUP', params.group.toUpperCase());
  else if (params.name) url.searchParams.set('NAME', params.name);
  else if (params.catnr) url.searchParams.set('CATNR', String(params.catnr));
  else url.searchParams.set('GROUP', 'STATIONS');
  url.searchParams.set('FORMAT', format);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: format === 'JSON' ? 'application/json' : 'text/plain',
      'User-Agent': 'ARTEMIS-Q/1.0 (local mission console)',
    },
  });
  if (!response.ok) {
    throw new Error(`CelesTrak HTTP ${response.status}`);
  }
  return response.json() as Promise<CelestrakOmmRecord[]>;
}

export async function fetchCelestrakTrafficAssessment(params?: {
  group?: string;
  name?: string;
  catnr?: string | number;
  limit?: number;
  horizonSeconds?: number;
  dtSeconds?: number;
}): Promise<CelestrakTrafficAssessment> {
  const records = await fetchCelestrakGp({
    group: params?.group,
    name: params?.name,
    catnr: params?.catnr,
    format: 'JSON',
  });
  const limited = records.slice(0, Math.max(2, params?.limit ?? 12));
  const nodes = limited
    .map((record, index) => recordToNode(record, index, limited.length))
    .filter((node): node is GeneratedMissionNode => Boolean(node));

  const conjunctions: ConjunctionAssessment[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      conjunctions.push(assessConjunction(nodes[i], nodes[j], params?.horizonSeconds ?? 86400, params?.dtSeconds ?? 120));
    }
  }

  conjunctions.sort((a, b) => (
    b.collisionProbability - a.collisionProbability ||
    a.closestApproachKm - b.closestApproachKm
  ));

  return {
    records: limited,
    nodes,
    conjunctions: conjunctions.slice(0, 12),
    source: 'LIVE · CelesTrak GP',
  };
}
