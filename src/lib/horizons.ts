import * as THREE from 'three';
import {
  heliocentricHorizonsKmToScene,
  heliocentricHorizonsVelocityKmPerSToScene,
} from './celestial';
import {
  CISLUNAR_VIS_KM_PER_UNIT,
  computeHohmann,
  type KeplerianElements,
  keplerian2ECI,
  RE,
  type TrajectoryPoint,
} from './orbital';
import { normalize3, slerpUnitVectors } from './lunarEphemeris';
import type { LaunchWindowEvaluation } from './launchWindow';

const HORIZONS_API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';

export interface HorizonsQuery {
  COMMAND: string;
  CENTER: string;
  START_TIME: string;
  STOP_TIME: string;
  STEP_SIZE?: string;
  EPHEM_TYPE?: 'OBSERVER' | 'VECTORS' | 'ELEMENTS';
  OUT_UNITS?: 'KM-S' | 'AU-D' | 'KM-D';
  REF_SYSTEM?: 'ICRF' | 'B1950';
  VEC_TABLE?: string;
  VEC_CORR?: 'NONE' | 'LT' | 'LT+S';
  OBJ_DATA?: 'YES' | 'NO';
  CSV_FORMAT?: 'YES' | 'NO';
  CAL_FORMAT?: 'CAL' | 'JD' | 'BOTH';
  TIME_TYPE?: 'UT' | 'TT' | 'TDB';
  MAKE_EPHEM?: 'YES' | 'NO';
}

export interface HorizonsVectorRow {
  jd: number;
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

export interface HorizonsApiResponse {
  signature?: {
    source?: string;
    version?: string;
  };
  result?: string;
  error?: string;
  message?: string;
}

export interface HorizonsTransferEstimate {
  transferTimeDays: number;
  deltaV_ms: number;
  departureRangeKm: number;
  arrivalRangeKm: number;
  alignmentScore: number;
}

const MAJOR_BODY_IDS: Record<string, string> = {
  mercury: '199',
  venus: '299',
  earth: '399',
  moon: '301',
  mars: '499',
  jupiter: '599',
  saturn: '699',
  uranus: '799',
  neptune: '899',
  pluto: '999',
  sun: '10',
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function getHorizonsMajorBodyId(bodyId: string): string {
  return MAJOR_BODY_IDS[bodyId.toLowerCase()] ?? '399';
}

export function buildHorizonsUrl(query: HorizonsQuery): string {
  const params = new URLSearchParams();
  params.set('format', 'json');
  params.set('MAKE_EPHEM', query.MAKE_EPHEM ?? 'YES');
  params.set('OBJ_DATA', query.OBJ_DATA ?? 'NO');
  params.set('EPHEM_TYPE', query.EPHEM_TYPE ?? 'VECTORS');
  params.set('COMMAND', query.COMMAND);
  params.set('CENTER', query.CENTER);
  params.set('START_TIME', query.START_TIME);
  params.set('STOP_TIME', query.STOP_TIME);
  params.set('STEP_SIZE', query.STEP_SIZE ?? '1 d');
  params.set('OUT_UNITS', query.OUT_UNITS ?? 'KM-S');
  params.set('REF_SYSTEM', query.REF_SYSTEM ?? 'ICRF');
  params.set('VEC_TABLE', query.VEC_TABLE ?? '2');
  params.set('VEC_CORR', query.VEC_CORR ?? 'NONE');
  params.set('CSV_FORMAT', query.CSV_FORMAT ?? 'YES');
  params.set('CAL_FORMAT', query.CAL_FORMAT ?? 'JD');
  params.set('TIME_TYPE', query.TIME_TYPE ?? 'UT');
  return `${HORIZONS_API_URL}?${params.toString()}`;
}

function extractSoeRows(result: string): string[] {
  const start = result.indexOf('$$SOE');
  const end = result.indexOf('$$EOE');
  if (start < 0 || end < 0 || end <= start) return [];
  return result
    .slice(start + '$$SOE'.length, end)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseNumericCsvLine(line: string): number[] {
  return line
    .split(',')
    .map((token) => Number(token.trim()))
    .filter((value) => Number.isFinite(value));
}

export function parseHorizonsVectorTable(payload: HorizonsApiResponse): HorizonsVectorRow[] {
  if (payload.error || payload.message) {
    throw new Error(payload.error || payload.message || 'Horizons request failed');
  }
  const result = payload.result ?? '';
  if (/No ephemeris|Cannot interpret|not found|ERROR/i.test(result)) {
    throw new Error(`Horizons returned a non-ephemeris response: ${result.slice(0, 180)}`);
  }

  const rows: HorizonsVectorRow[] = [];
  for (const line of extractSoeRows(result)) {
    const values = parseNumericCsvLine(line);
    if (values.length < 4) continue;
    const [jd, x, y, z, vx, vy, vz] = values;
    rows.push({ jd, x, y, z, vx, vy, vz });
  }
  return rows;
}

export async function fetchHorizonsVectors(query: HorizonsQuery): Promise<HorizonsVectorRow[]> {
  const response = await fetch(buildHorizonsUrl(query));
  if (!response.ok) {
    throw new Error(`Horizons HTTP ${response.status}`);
  }
  const payload = await response.json() as HorizonsApiResponse;
  return parseHorizonsVectorTable(payload);
}

function cubicTransferBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  startVelocity: THREE.Vector3,
  endVelocity: THREE.Vector3,
  nPoints: number,
  startTimeS: number,
  durationS: number,
  labelPrefix: string,
): TrajectoryPoint[] {
  const tangentScale = durationS * 0.16;
  const control1 = start.clone().add(startVelocity.clone().multiplyScalar(tangentScale));
  const control2 = end.clone().sub(endVelocity.clone().multiplyScalar(tangentScale));
  const curve = new THREE.CubicBezierCurve3(start, control1, control2, end);
  const points = curve.getPoints(nPoints);
  return points.map((point, idx) => ({
    pos: [point.x, point.y, point.z],
    time_s: startTimeS + (durationS * idx) / nPoints,
    label:
      idx === 0 ? `${labelPrefix} Departure` :
      idx === Math.floor(nPoints * 0.5) ? `${labelPrefix} Cruise` :
      idx === nPoints ? `${labelPrefix} Arrival` :
      undefined,
  }));
}

function annotate(points: TrajectoryPoint[], events: Array<{ timeS: number; label: string; step: number }>): TrajectoryPoint[] {
  const annotations = new Map<number, { label: string; step: number }>();
  for (const event of events) {
    let bestIdx = 0;
    let bestDt = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length; i++) {
      const dt = Math.abs((points[i].time_s ?? 0) - event.timeS);
      if (dt < bestDt) {
        bestDt = dt;
        bestIdx = i;
      }
    }
    annotations.set(bestIdx, { label: event.label, step: event.step });
  }
  return points.map((point, index) => {
    const marker = annotations.get(index);
    return marker ? { ...point, label: marker.label, step: marker.step } : point;
  });
}

function differenceVelocity(a: HorizonsVectorRow, b: HorizonsVectorRow): THREE.Vector3 {
  const dtDays = Math.max(Math.abs(b.jd - a.jd), 1e-6);
  const dtSeconds = dtDays * 86400;
  return new THREE.Vector3(
    (b.x - a.x) / dtSeconds,
    (b.y - a.y) / dtSeconds,
    (b.z - a.z) / dtSeconds,
  );
}

function norm(row: HorizonsVectorRow): number {
  return Math.hypot(row.x, row.y, row.z);
}

function dotUnit(a: HorizonsVectorRow, b: HorizonsVectorRow): number {
  const na = norm(a);
  const nb = norm(b);
  if (na <= 0 || nb <= 0) return 0;
  return (a.x * b.x + a.y * b.y + a.z * b.z) / (na * nb);
}

export async function fetchHorizonsTransferEstimate(params: {
  launchDate: string;
  destinationId: string;
  launchBodyId: string;
  keplerEl?: KeplerianElements;
}): Promise<HorizonsTransferEstimate> {
  const launchDate = new Date(params.launchDate);
  const destinationId = params.destinationId.toLowerCase();
  const launchBodyId = params.launchBodyId.toLowerCase();

  if (destinationId === 'moon' && launchBodyId === 'earth') {
    const keplerEl = params.keplerEl ?? { a: 6778, e: 0.0008, i: 51.6, raan: 247, argp: 130, nu: 0 };
    const state0 = keplerian2ECI(keplerEl);
    const r1 = Math.hypot(state0.r[0], state0.r[1], state0.r[2]);
    const leoAlt = Math.max(150, r1 - RE);
    const departureMoon = await fetchHorizonsVectors({
      COMMAND: `'301'`,
      CENTER: `'500@399'`,
      START_TIME: `'${isoDate(launchDate)}'`,
      STOP_TIME: `'${isoDate(new Date(launchDate.getTime() + 24 * 3600 * 1000))}'`,
      STEP_SIZE: `'12 h'`,
    });
    const moonDeparture = departureMoon[0];
    if (!moonDeparture) throw new Error('Unable to fetch lunar departure geometry from Horizons');
    const departureRangeKm = norm(moonDeparture);
    const hoh = computeHohmann(leoAlt, Math.max(250_000, departureRangeKm - RE));
    const arrivalDate = new Date(launchDate.getTime() + hoh.tof_s * 1000);
    const arrivalMoon = await fetchHorizonsVectors({
      COMMAND: `'301'`,
      CENTER: `'500@399'`,
      START_TIME: `'${isoDate(arrivalDate)}'`,
      STOP_TIME: `'${isoDate(new Date(arrivalDate.getTime() + 24 * 3600 * 1000))}'`,
      STEP_SIZE: `'12 h'`,
    });
    const moonArrival = arrivalMoon[0] ?? moonDeparture;
    const alignmentScore = 0.5 * (1 + dotUnit(moonDeparture, moonArrival));
    return {
      transferTimeDays: hoh.tof_days,
      deltaV_ms: hoh.dvTotal_ms * (1 + 0.08 * (1 - alignmentScore)),
      departureRangeKm,
      arrivalRangeKm: norm(moonArrival),
      alignmentScore,
    };
  }

  const command = getHorizonsMajorBodyId(destinationId);
  const center = `'500@${getHorizonsMajorBodyId(launchBodyId)}'`;
  const departureWindow = await fetchHorizonsVectors({
    COMMAND: `'${command}'`,
    CENTER: center,
    START_TIME: `'${isoDate(launchDate)}'`,
    STOP_TIME: `'${isoDate(new Date(launchDate.getTime() + 24 * 3600 * 1000))}'`,
    STEP_SIZE: `'12 h'`,
  });
  const departure = departureWindow[0];
  if (!departure) throw new Error('Unable to fetch departure geometry from Horizons');
  const departureRangeKm = norm(departure);
  const transferTimeDays = Math.max(30, departureRangeKm / 38000);
  const arrivalDate = new Date(launchDate.getTime() + transferTimeDays * 86400 * 1000);
  const arrivalWindow = await fetchHorizonsVectors({
    COMMAND: `'${command}'`,
    CENTER: center,
    START_TIME: `'${isoDate(arrivalDate)}'`,
    STOP_TIME: `'${isoDate(new Date(arrivalDate.getTime() + 24 * 3600 * 1000))}'`,
    STEP_SIZE: `'12 h'`,
  });
  const arrival = arrivalWindow[0] ?? departure;
  const alignmentScore = 0.5 * (1 + dotUnit(departure, arrival));

  return {
    transferTimeDays,
    deltaV_ms: Math.max(1200, departureRangeKm * 0.012 * (1 + 0.2 * (1 - alignmentScore))),
    departureRangeKm,
    arrivalRangeKm: norm(arrival),
    alignmentScore,
  };
}

export async function fetchHorizonsLaunchWindowEvaluations(params: {
  launchDate: string;
  destinationId: string;
  launchBodyId: string;
  offsetsHours: number[];
  baseRadiation: number;
  baseCommunication: number;
  keplerEl?: KeplerianElements;
}): Promise<LaunchWindowEvaluation[]> {
  const evaluations: LaunchWindowEvaluation[] = [];
  const baseline = await fetchHorizonsTransferEstimate({
    launchDate: params.launchDate,
    destinationId: params.destinationId,
    launchBodyId: params.launchBodyId,
    keplerEl: params.keplerEl,
  });

  for (const offsetHours of params.offsetsHours) {
    const shiftedLaunch = new Date(new Date(params.launchDate).getTime() + offsetHours * 3600 * 1000);
    const estimate = await fetchHorizonsTransferEstimate({
      launchDate: shiftedLaunch.toISOString(),
      destinationId: params.destinationId,
      launchBodyId: params.launchBodyId,
      keplerEl: params.keplerEl,
    });
    const communicationAvailability = Math.max(
      0,
      Math.min(1, params.baseCommunication * (0.88 + 0.12 * estimate.alignmentScore)),
    );
    const radiationExposure = params.baseRadiation * (1 + 0.1 * (1 - estimate.alignmentScore));
    const normalizedCost = estimate.deltaV_ms / Math.max(baseline.deltaV_ms, 1);
    const normalizedRisk = radiationExposure / Math.max(params.baseRadiation, 1e-6);
    const normalizedCommPenalty = 1 - communicationAvailability;
    const score = 0.45 * normalizedRisk + 0.35 * normalizedCost + 0.2 * normalizedCommPenalty;

    evaluations.push({
      window: {
        launchTimeIso: shiftedLaunch.toISOString(),
        offsetHours,
        epochMs: shiftedLaunch.getTime(),
        phaseAngleRad: Math.acos(Math.max(-1, Math.min(1, 2 * estimate.alignmentScore - 1))),
        alignmentScore: estimate.alignmentScore,
      },
      deltaV_ms: estimate.deltaV_ms,
      radiationExposure,
      communicationAvailability,
      score,
    });
  }

  return evaluations.sort((a, b) => a.score - b.score);
}

export async function buildHorizonsTrajectory(params: {
  launchDate: string;
  destinationId: string;
  launchBodyId: string;
  keplerEl: KeplerianElements;
}): Promise<TrajectoryPoint[]> {
  const launchDate = new Date(params.launchDate);
  const destinationId = params.destinationId.toLowerCase();
  const launchBodyId = params.launchBodyId.toLowerCase();

  if (destinationId === 'moon' && launchBodyId === 'earth') {
    const state0 = keplerian2ECI(params.keplerEl);
    const r1 = Math.hypot(state0.r[0], state0.r[1], state0.r[2]);
    const leoAlt = Math.max(150, r1 - RE);
    const initialMoon = await fetchHorizonsVectors({
      COMMAND: `'301'`,
      CENTER: `'500@399'`,
      START_TIME: `'${isoDate(launchDate)}'`,
      STOP_TIME: `'${isoDate(new Date(launchDate.getTime() + 24 * 3600 * 1000))}'`,
      STEP_SIZE: `'12 h'`,
    });
    const firstMoonRange = initialMoon[0]
      ? Math.hypot(initialMoon[0].x, initialMoon[0].y, initialMoon[0].z) - RE
      : 384400 - RE;
    const hoh = computeHohmann(leoAlt, Math.max(250_000, firstMoonRange));
    const stayDays = 0.3;
    const arrivalDate = new Date(launchDate.getTime() + hoh.tof_s * 1000);
    const returnDate = new Date(arrivalDate.getTime() + stayDays * 86400 * 1000);
    const endDate = new Date(returnDate.getTime() + hoh.tof_s * 1000);
    const moonVectors = await fetchHorizonsVectors({
      COMMAND: `'301'`,
      CENTER: `'500@399'`,
      START_TIME: `'${isoDate(arrivalDate)}'`,
      STOP_TIME: `'${isoDate(endDate)}'`,
      STEP_SIZE: `'12 h'`,
    });
    const moonArrival = moonVectors[0];
    const moonReturn = moonVectors[Math.min(moonVectors.length - 1, Math.max(1, Math.floor(moonVectors.length * 0.35)))];
    if (!moonArrival || !moonReturn) {
      throw new Error('Horizons did not return enough lunar vectors');
    }

    const inv = 1 / CISLUNAR_VIS_KM_PER_UNIT;
    const toScene = (km: [number, number, number]): [number, number, number] => [km[0] * inv, km[1] * inv, km[2] * inv];
    const leoHat = normalize3(state0.r);
    const moonHat = normalize3([moonArrival.x, moonArrival.y, moonArrival.z]);
    const moonHatR = normalize3([moonReturn.x, moonReturn.y, moonReturn.z]);
    const r2 = Math.hypot(moonArrival.x, moonArrival.y, moonArrival.z);
    const r2r = Math.hypot(moonReturn.x, moonReturn.y, moonReturn.z);
    const a = (r1 + r2) / 2;
    const e = (r2 - r1) / (r2 + r1);
    const p = a * (1 - e * e);
    const aR = (r2r + r1) / 2;
    const eR = Math.abs(r2r - r1) / (r2r + r1);
    const pR = aR * (1 - eR * eR);
    const segments = 96;

    const outbound: TrajectoryPoint[] = [];
    for (let i = 0; i <= segments; i++) {
      const nu = (i / segments) * Math.PI;
      const rKm = p / (1 + e * Math.cos(nu));
      const dir = slerpUnitVectors(leoHat, moonHat, nu / Math.PI);
      outbound.push({
        pos: toScene([dir[0] * rKm, dir[1] * rKm, dir[2] * rKm]),
        time_s: (i / segments) * hoh.tof_s,
      });
    }

    const stayS = stayDays * 86400;
    const inbound: TrajectoryPoint[] = [];
    for (let i = 1; i <= segments; i++) {
      const nu = (i / segments) * Math.PI;
      const rKm = pR / (1 + eR * Math.cos(nu));
      const dir = slerpUnitVectors(moonHatR, leoHat, nu / Math.PI);
      inbound.push({
        pos: toScene([dir[0] * rKm, dir[1] * rKm, dir[2] * rKm]),
        time_s: hoh.tof_s + stayS + (i / segments) * hoh.tof_s,
      });
    }

    return annotate([...outbound, ...inbound], [
      { timeS: 0, label: 'Parking Orbit', step: 1 },
      { timeS: Math.min(Math.max(900, 0.08 * hoh.tof_s), 0.45 * hoh.tof_s), label: 'Transfer Burn', step: 2 },
      { timeS: 0.5 * hoh.tof_s, label: 'Translunar coast', step: 3 },
      { timeS: 0.92 * hoh.tof_s, label: 'Lunar approach', step: 4 },
      { timeS: hoh.tof_s + 0.35 * stayS, label: 'Encounter', step: 5 },
      { timeS: hoh.tof_s + stayS + 0.45 * hoh.tof_s, label: 'Return coast', step: 6 },
      { timeS: 2 * hoh.tof_s + stayS - 0.04 * hoh.tof_s, label: 'Entry', step: 7 },
      { timeS: 2 * hoh.tof_s + stayS, label: 'Landing', step: 8 },
    ]);
  }

  const command = getHorizonsMajorBodyId(destinationId);
  const center = `'500@${getHorizonsMajorBodyId(launchBodyId)}'`;
  const transferDays = Math.max(30, destinationId === 'mars' ? 220 : destinationId === 'venus' ? 150 : 120);
  const departureDate = new Date(launchDate);
  const arrivalDate = new Date(departureDate.getTime() + transferDays * 86400 * 1000);
  const returnDate = new Date(arrivalDate.getTime() + transferDays * 86400 * 1000);
  const vectors = await fetchHorizonsVectors({
    COMMAND: `'${command}'`,
    CENTER: center,
    START_TIME: `'${isoDate(departureDate)}'`,
    STOP_TIME: `'${isoDate(returnDate)}'`,
    STEP_SIZE: `'12 h'`,
  });
  if (vectors.length < 4) {
    throw new Error('Horizons returned insufficient major-body vectors');
  }

  const outboundDurationS = transferDays * 86400;
  const inboundDurationS = transferDays * 86400;
  const arrivalIndex = Math.max(1, Math.floor(vectors.length * 0.5));
  const origin = new THREE.Vector3(0, 0, 0);
  const destinationOutbound = new THREE.Vector3(...heliocentricHorizonsKmToScene(vectors[arrivalIndex]));
  const returnTarget = new THREE.Vector3(0, 0, 0);
  const originVelocity = new THREE.Vector3(0, 0, 0);
  const destinationArrivalVelocity = new THREE.Vector3(
    ...heliocentricHorizonsVelocityKmPerSToScene(differenceVelocity(vectors[arrivalIndex - 1], vectors[arrivalIndex])),
  );
  const returnVelocity = new THREE.Vector3(0, 0, 0);

  const outbound = cubicTransferBetween(origin, destinationOutbound, originVelocity, destinationArrivalVelocity, 64, 0, outboundDurationS, 'Outbound');
  const inbound = cubicTransferBetween(destinationOutbound, returnTarget, destinationArrivalVelocity, returnVelocity, 64, outboundDurationS, inboundDurationS, 'Inbound');

  return annotate([...outbound, ...inbound.slice(1)], [
    { timeS: 0, label: 'Parking Orbit', step: 1 },
    { timeS: 0.08 * outboundDurationS, label: 'Transfer Burn', step: 2 },
    { timeS: 0.55 * outboundDurationS, label: 'Transfer coast', step: 3 },
    { timeS: outboundDurationS * 0.9, label: 'Approach', step: 4 },
    { timeS: outboundDurationS, label: 'Encounter', step: 5 },
    { timeS: outboundDurationS + 0.45 * inboundDurationS, label: 'Return coast', step: 6 },
    { timeS: outboundDurationS + 0.92 * inboundDurationS, label: 'Entry', step: 7 },
    { timeS: outboundDurationS + inboundDurationS, label: 'Landing', step: 8 },
  ]);
}
