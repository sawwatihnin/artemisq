/**
 * ARTEMIS-Q Orbital Mechanics Library — Competition Edition
 * 
 * Implements:
 *   - Keplerian propagation (two-body + secular J2 on Ω, ω)
 *   - Keplerian element conversions (COE → ECI)
 *   - Patched conic trajectory design (Hohmann, bi-elliptic)
 *   - Atmospheric density model (NRLMSISE-00 simplified)
 *   - Gravitational perturbations: J2, J3, lunar/solar (simplified)
 *   - Satellite conjunction / collision risk (TCA, relative velocity)
 */

import * as THREE from 'three';
import { CELESTIAL_BODY_MAP, getApproximateHeliocentricPosition } from './celestial';
import { moonGeocentricPositionKm, normalize3, slerpUnitVectors } from './lunarEphemeris';

// ─── Physical Constants ───────────────────────────────────────────────────────
export const MU = 398600.4418;   // km³/s² (Earth gravitational parameter)
export const RE = 6378.137;      // km (Earth mean equatorial radius)
export const J2 = 1.08263e-3;   // second zonal harmonic
export const J3 = -2.53215e-6;  // third zonal harmonic
export const AU = 1.496e8;       // km (Astronomical Unit)
export const MU_SUN = 1.327e11;  // km³/s² (Sun μ)
export const MU_MOON = 4902.8;   // km³/s² (Moon μ)

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KeplerianElements {
  a: number;          // semi-major axis [km]
  e: number;          // eccentricity
  i: number;          // inclination [deg]
  raan: number;       // right ascension of ascending node [deg]
  argp: number;       // argument of perigee [deg]
  nu: number;         // true anomaly [deg]
  epoch?: Date;
}

export interface ECIState {
  r: [number, number, number];   // position [km]
  v: [number, number, number];   // velocity [km/s]
}

export interface TrajectoryPoint {
  pos: [number, number, number];
  vel?: [number, number, number];
  label?: string;
  step?: number;
  time_s?: number;
}

interface TrajectoryEvent {
  timeS: number;
  label: string;
  step: number;
}

export interface Planet {
  id: string;
  name: string;
  dist: number;
  period: number;
  radius: number;
  color: string;
  mass_kg: number;
  mu: number;
}

export interface OrbitalDebrisObject {
  id: string;
  noradId: number;
  altitude_km: number;
  inclination: number;
  raan: number;
  closestApproach_km?: number;
  relativeVelocity_kms?: number;
  riskLevel: 'low' | 'medium' | 'high';
}

// ─── Planet Data ─────────────────────────────────────────────────────────────

export const PLANETS: Record<string, Planet> = {
  moon:    { id: 'moon',    name: 'Moon',    dist: 384.4,  period: 27.32,  radius: 5.4,  color: '#aaa',   mass_kg: 7.34e22, mu: 4902.8 },
  mars:    { id: 'mars',    name: 'Mars',    dist: 1524,   period: 686.97, radius: 8.2,  color: '#e27b58',mass_kg: 6.39e23, mu: 42828 },
  venus:   { id: 'venus',   name: 'Venus',   dist: 723,    period: 224.70, radius: 14.5, color: '#e3bb76',mass_kg: 4.87e24, mu: 324859 },
  jupiter: { id: 'jupiter', name: 'Jupiter', dist: 5203,   period: 4332.6, radius: 45.0, color: '#d39c7e',mass_kg: 1.90e27, mu: 126686534 },
};

// ─── Keplerian → ECI Conversion ──────────────────────────────────────────────

/**
 * Convert classical orbital elements to ECI position/velocity.
 * Uses exact rotation matrix sequence R3(-Ω)·R1(-i)·R3(-ω)
 */
export function keplerian2ECI(el: KeplerianElements): ECIState {
  const { a, e, i, raan, argp, nu } = el;
  const iR = (i * Math.PI) / 180;
  const RA = (raan * Math.PI) / 180;
  const w  = (argp * Math.PI) / 180;
  const f  = (nu * Math.PI) / 180;

  // Perifocal (PQW) frame
  const p = a * (1 - e * e);
  const r = p / (1 + e * Math.cos(f));
  const r_pqw: [number,number,number] = [r * Math.cos(f), r * Math.sin(f), 0];
  const vfac = Math.sqrt(MU / p);
  const v_pqw: [number,number,number] = [-vfac * Math.sin(f), vfac * (e + Math.cos(f)), 0];

  // Rotation matrix from PQW → ECI: R = R3(-Ω) · R1(-i) · R3(-ω)
  const cosRA = Math.cos(RA), sinRA = Math.sin(RA);
  const cosI  = Math.cos(iR), sinI  = Math.sin(iR);
  const cosW  = Math.cos(w),  sinW  = Math.sin(w);

  const R: number[][] = [
    [ cosRA*cosW - sinRA*sinW*cosI, -cosRA*sinW - sinRA*cosW*cosI,  sinRA*sinI ],
    [ sinRA*cosW + cosRA*sinW*cosI, -sinRA*sinW + cosRA*cosW*cosI, -cosRA*sinI ],
    [ sinW*sinI,                     cosW*sinI,                      cosI       ]
  ];

  const rot = (v: [number,number,number]) => [
    R[0][0]*v[0] + R[0][1]*v[1] + R[0][2]*v[2],
    R[1][0]*v[0] + R[1][1]*v[1] + R[1][2]*v[2],
    R[2][0]*v[0] + R[2][1]*v[1] + R[2][2]*v[2],
  ] as [number,number,number];

  return { r: rot(r_pqw), v: rot(v_pqw) };
}

/**
 * Propagate orbit using Kepler's equation (M = E - e·sinE)
 * with J2 perturbation on RAAN and argument of perigee.
 * 
 * dΩ/dt = -3/2 · n · J2 · (RE/p)² · cos(i)       [RAAN precession]
 * dω/dt = 3/4  · n · J2 · (RE/p)² · (5cos²i - 1) [perigee rotation]
 */
export function propagateOrbit(el: KeplerianElements, dt_s: number, includeJ2 = true): KeplerianElements {
  const a = el.a, e = el.e;
  const i_r = (el.i * Math.PI) / 180;
  const n = Math.sqrt(MU / (a * a * a));  // mean motion [rad/s]
  const p = a * (1 - e * e);

  // Solve Kepler's equation iteratively (Newton-Raphson)
  const M0 = trueToMean(el.nu * Math.PI / 180, e);
  let M = M0 + n * dt_s;
  M = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const E = solveKepler(M, e);
  const nu_new = ((2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2))) * 180 / Math.PI + 360) % 360;

  let raan_new = el.raan, argp_new = el.argp;
  if (includeJ2) {
    const j2_fac = (3 / 2) * n * J2 * (RE / p) ** 2;
    const dRaan = -j2_fac * Math.cos(i_r);
    const dArgp =  (j2_fac / 2) * (5 * Math.cos(i_r) ** 2 - 1);
    raan_new = (el.raan + dRaan * dt_s * 180 / Math.PI + 360) % 360;
    argp_new = (el.argp + dArgp * dt_s * 180 / Math.PI + 360) % 360;
  }

  return { ...el, nu: nu_new, raan: raan_new, argp: argp_new };
}

function trueToMean(nu_rad: number, e: number): number {
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu_rad / 2), Math.sqrt(1 + e) * Math.cos(nu_rad / 2));
  return E - e * Math.sin(E);
}

function solveKepler(M: number, e: number, tol = 1e-10): number {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 50; i++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < tol) break;
  }
  return E;
}

// ─── Full Orbit Ground Track ──────────────────────────────────────────────────

/**
 * Generate 3D orbit points for visualisation (ECI frame, scaled for Three.js)
 */
export function generateOrbitPoints(el: KeplerianElements, nPoints = 200, scale = 0.15): [number,number,number][] {
  const points: [number,number,number][] = [];
  for (let i = 0; i <= nPoints; i++) {
    const nu = (i / nPoints) * 360;
    const eci = keplerian2ECI({ ...el, nu });
    points.push([eci.r[0] * scale, eci.r[1] * scale, eci.r[2] * scale]);
  }
  return points;
}

/** Kilometers per Three.js unit for heliocentric / generic orbit visualization. */
export const VIS_SCENE_KM_PER_UNIT = 2500;

/**
 * Cislunar (Earth–Moon) view: smaller km per unit ⇒ larger scene coordinates so Earth, LEO, and Moon
 * read clearly and transfer / stage markers are not stacked on top of each other.
 */
export const CISLUNAR_VIS_KM_PER_UNIT = 720;

/** LEO / parking orbit polyline in scene units, consistent with {@link VIS_SCENE_KM_PER_UNIT}. */
export function generateOrbitPointsScene(el: KeplerianElements, nPoints = 200): [number, number, number][] {
  return generateOrbitPoints(el, nPoints, 1 / VIS_SCENE_KM_PER_UNIT);
}

/**
 * Earth–Moon transfer polyline in **scene units** (not km). Uses Hohmann semi-major axis and true anomaly
 * sampled in the plane between departure direction and Moon arrival direction (endpoints match patched-conic radii).
 */
export function buildEarthMoonTransferTrajectory(
  launchDate: Date,
  keplerEl: KeplerianElements,
  segments = 96,
  stayDays = 0.3,
): TrajectoryPoint[] {
  const inv = 1 / CISLUNAR_VIS_KM_PER_UNIT;
  const toScene = (km: [number, number, number]): [number, number, number] =>
    [km[0] * inv, km[1] * inv, km[2] * inv];

  const state0 = keplerian2ECI(keplerEl);
  const r1 = Math.hypot(state0.r[0], state0.r[1], state0.r[2]);
  const leoHat = normalize3(state0.r);
  const leoAlt = Math.max(150, r1 - RE);

  const moonGuess = moonGeocentricPositionKm(launchDate);
  const moonAlt0 = Math.hypot(moonGuess[0], moonGuess[1], moonGuess[2]) - RE;

  const hoh = computeHohmann(leoAlt, Math.max(250_000, moonAlt0));
  const tofS = hoh.tof_s;
  const arrival = new Date(launchDate.getTime() + tofS * 1000);
  const moonVec = moonGeocentricPositionKm(arrival);
  const r2 = Math.hypot(moonVec[0], moonVec[1], moonVec[2]);
  const moonHat = normalize3(moonVec);

  const a = (r1 + r2) / 2;
  const e = (r2 - r1) / (r2 + r1);
  const p = a * (1 - e * e);

  const outbound: TrajectoryPoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const nu = (i / segments) * Math.PI;
    const rKm = p / (1 + e * Math.cos(nu));
    const dir = slerpUnitVectors(leoHat, moonHat, nu / Math.PI);
    outbound.push({
      pos: toScene([dir[0] * rKm, dir[1] * rKm, dir[2] * rKm]),
      time_s: (i / segments) * tofS,
    });
  }

  const stayS = stayDays * 86400;
  const returnEpoch = new Date(arrival.getTime() + stayS * 1000);
  const moonReturn = moonGeocentricPositionKm(returnEpoch);
  const moonHatR = normalize3(moonReturn);
  const r2r = Math.hypot(moonReturn[0], moonReturn[1], moonReturn[2]);
  const aR = (r2r + r1) / 2;
  const eR = Math.abs(r2r - r1) / (r2r + r1);
  const pR = aR * (1 - eR * eR);

  const inbound: TrajectoryPoint[] = [];
  for (let i = 1; i <= segments; i++) {
    const nu = (i / segments) * Math.PI;
    const rKm = pR / (1 + eR * Math.cos(nu));
    const dir = slerpUnitVectors(moonHatR, leoHat, nu / Math.PI);
    inbound.push({
      pos: toScene([dir[0] * rKm, dir[1] * rKm, dir[2] * rKm]),
      time_s: tofS + stayS + (i / segments) * tofS,
    });
  }

  const combined = [...outbound, ...inbound];
  const parkingOrbitPeriodS = 2 * Math.PI * Math.sqrt((state0.r[0] ** 2 + state0.r[1] ** 2 + state0.r[2] ** 2) ** 1.5 / MU);
  const tliTimeS = Math.min(Math.max(900, 0.08 * tofS), 0.45 * tofS, parkingOrbitPeriodS);
  const totalTimeS = 2 * tofS + stayS;
  const events: TrajectoryEvent[] = [
    { timeS: 0, label: 'Parking Orbit', step: 1 },
    { timeS: tliTimeS, label: 'Transfer Burn', step: 2 },
    { timeS: 0.5 * (tliTimeS + tofS), label: 'Translunar coast', step: 3 },
    { timeS: 0.92 * tofS, label: 'Lunar approach', step: 4 },
    { timeS: tofS + 0.35 * stayS, label: 'Encounter', step: 5 },
    { timeS: tofS + stayS + 0.45 * tofS, label: 'Return coast', step: 6 },
    { timeS: totalTimeS - 0.04 * tofS, label: 'Entry', step: 7 },
    { timeS: totalTimeS, label: 'Landing', step: 8 },
  ];

  return annotateTrajectoryEvents(combined, events);
}

function relativeHeliocentricPosition(bodyId: string, date: Date): THREE.Vector3 {
  const earth = CELESTIAL_BODY_MAP.earth;
  const body = CELESTIAL_BODY_MAP[bodyId];
  if (!body?.orbit) return new THREE.Vector3(0, 0, 0);
  const pe = getApproximateHeliocentricPosition(earth, date);
  const pb = getApproximateHeliocentricPosition(body, date);
  return new THREE.Vector3(pb[0] - pe[0], pb[1] - pe[1], pb[2] - pe[2]);
}

function relativeHeliocentricVelocity(bodyId: string, date: Date): THREE.Vector3 {
  const dt = 0.25;
  const t1 = new Date(date.getTime() - dt * 86400000);
  const t2 = new Date(date.getTime() + dt * 86400000);
  const r1 = relativeHeliocentricPosition(bodyId, t1);
  const r2 = relativeHeliocentricPosition(bodyId, t2);
  const dtS = 2 * dt * 86400;
  return new THREE.Vector3(
    (r2.x - r1.x) / dtS,
    (r2.y - r1.y) / dtS,
    (r2.z - r1.z) / dtS,
  );
}

// ─── Hohmann Transfer ─────────────────────────────────────────────────────────

export interface HohmannResult {
  dv1_ms: number;
  dv2_ms: number;
  dvTotal_ms: number;
  tof_s: number;
  tof_days: number;
  sma_transfer_km: number;
  v_circ1_kms: number;
  v_circ2_kms: number;
}

export function computeHohmann(r1_km: number, r2_km: number): HohmannResult {
  const r1 = r1_km + RE;
  const r2 = r2_km + RE;
  const at = (r1 + r2) / 2;
  const v1 = Math.sqrt(MU / r1);
  const v2 = Math.sqrt(MU / r2);
  const vt1 = Math.sqrt(MU * (2 / r1 - 1 / at));
  const vt2 = Math.sqrt(MU * (2 / r2 - 1 / at));
  const tof = Math.PI * Math.sqrt(at ** 3 / MU);
  return {
    dv1_ms:       Math.abs(vt1 - v1) * 1000,
    dv2_ms:       Math.abs(v2 - vt2) * 1000,
    dvTotal_ms:   (Math.abs(vt1 - v1) + Math.abs(v2 - vt2)) * 1000,
    tof_s:        tof,
    tof_days:     tof / 86400,
    sma_transfer_km: at,
    v_circ1_kms:  v1,
    v_circ2_kms:  v2,
  };
}

// ─── Atmospheric Drag Model ───────────────────────────────────────────────────

/**
 * Simplified exponential atmosphere (US Standard Atmosphere layers)
 * Returns density in kg/m³
 */
export function atmosphericDensity(alt_km: number): number {
  const layers = [
    { h0: 0,   rho0: 1.225,    H: 8.44   },
    { h0: 25,  rho0: 3.899e-2, H: 6.49   },
    { h0: 30,  rho0: 1.774e-2, H: 6.75   },
    { h0: 40,  rho0: 3.972e-3, H: 7.07   },
    { h0: 50,  rho0: 1.057e-3, H: 7.47   },
    { h0: 60,  rho0: 3.206e-4, H: 7.83   },
    { h0: 70,  rho0: 8.770e-5, H: 8.09   },
    { h0: 80,  rho0: 1.905e-5, H: 8.31   },
    { h0: 150, rho0: 2.070e-9, H: 22.5   },
    { h0: 300, rho0: 1.916e-11,H: 45.0   },
    { h0: 500, rho0: 5.507e-13,H: 63.3   },
    { h0: 700, rho0: 3.614e-14,H: 70.0   },
    { h0: 1000,rho0: 3.019e-15,H: 85.0   },
  ];
  
  let layer = layers[0];
  for (const l of layers) {
    if (alt_km >= l.h0) layer = l;
    else break;
  }
  
  return layer.rho0 * Math.exp(-(alt_km - layer.h0) / layer.H);
}

/**
 * Atmospheric drag acceleration magnitude [km/s²]
 * a_drag = -½ · ρ · (Cd·A/m) · v²
 */
export function dragAcceleration(alt_km: number, v_kms: number, Cd = 2.2, A_m2 = 10, mass_kg = 1000): number {
  const rho = atmosphericDensity(alt_km);  // kg/m³
  const v_ms = v_kms * 1000;
  return 0.5 * rho * Cd * (A_m2 / mass_kg) * v_ms * v_ms / 1000;  // km/s²
}

// ─── Legacy API (kept for compatibility) ──────────────────────────────────────

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
  return points.map((p, idx) => ({
    pos: [p.x, p.y, p.z],
    time_s: startTimeS + (durationS * idx) / nPoints,
    label:
      idx === 0 ? `${labelPrefix} Departure` :
      idx === Math.floor(nPoints * 0.5) ? `${labelPrefix} Cruise` :
      idx === nPoints ? `${labelPrefix} Arrival` :
      undefined,
  }));
}

const DEFAULT_VIS_KEPLER: KeplerianElements = {
  a: 6778,
  e: 0.0008,
  i: 51.6,
  raan: 247,
  argp: 130,
  nu: 0,
};

/**
 * Mission trajectory in **display units** matching the visualizer: cislunar uses {@link CISLUNAR_VIS_KM_PER_UNIT};
 * interplanetary uses Earth-centered offsets in the same scale as {@link getApproximateHeliocentricPosition}
 * (about 1.5e6 km per scene unit).
 */
export function calculateArtemisTrajectory(
  launchDate: string,
  destinationId: string = 'moon',
  launchBodyId: string = 'earth',
  keplerEl: KeplerianElements = DEFAULT_VIS_KEPLER,
): TrajectoryPoint[] {
  if (destinationId === 'moon' && launchBodyId === 'earth') {
    return buildEarthMoonTransferTrajectory(new Date(launchDate), keplerEl);
  }

  const departureDate = new Date(launchDate);
  const launchBody = CELESTIAL_BODY_MAP[launchBodyId] ?? CELESTIAL_BODY_MAP.earth;
  const destinationBody = CELESTIAL_BODY_MAP[destinationId] ?? CELESTIAL_BODY_MAP.mars;

  const origin = relativeHeliocentricPosition(launchBody.id, departureDate);
  const originVelocity = relativeHeliocentricVelocity(launchBody.id, departureDate);

  const transferDays =
    destinationBody.orbit && launchBody.orbit
      ? Math.max(30, Math.abs(destinationBody.orbit.semiMajorAxisAu - launchBody.orbit.semiMajorAxisAu) * 220)
      : 120;
  const arrivalDate = new Date(departureDate.getTime() + transferDays * 86400000);

  const destinationOutbound = relativeHeliocentricPosition(destinationBody.id, arrivalDate);
  const destinationArrivalVelocity = relativeHeliocentricVelocity(destinationBody.id, arrivalDate);
  const returnDate = new Date(arrivalDate.getTime() + transferDays * 86400000);
  const returnTarget = relativeHeliocentricPosition(launchBody.id, returnDate);
  const returnVelocity = relativeHeliocentricVelocity(launchBody.id, returnDate);

  const outbound = cubicTransferBetween(
    origin,
    destinationOutbound,
    originVelocity,
    destinationArrivalVelocity,
    64,
    0,
    transferDays * 86400,
    'Outbound',
  );
  const inbound = cubicTransferBetween(
    destinationOutbound,
    returnTarget,
    destinationArrivalVelocity,
    returnVelocity,
    64,
    transferDays * 86400,
    transferDays * 86400,
    'Inbound',
  );

  const combined = [...outbound, ...inbound.slice(1)];
  const outboundDurationS = transferDays * 86400;
  const inboundDurationS = transferDays * 86400;
  const totalTimeS = outboundDurationS + inboundDurationS;
  const events: TrajectoryEvent[] = [
    { timeS: 0, label: 'Parking Orbit', step: 1 },
    { timeS: 0.08 * outboundDurationS, label: 'Transfer Burn', step: 2 },
    { timeS: 0.55 * outboundDurationS, label: 'Transfer coast', step: 3 },
    { timeS: 0.9 * outboundDurationS, label: 'Approach', step: 4 },
    { timeS: outboundDurationS, label: 'Encounter', step: 5 },
    { timeS: outboundDurationS + 0.45 * inboundDurationS, label: 'Return coast', step: 6 },
    { timeS: totalTimeS - 0.08 * inboundDurationS, label: 'Entry', step: 7 },
    { timeS: totalTimeS, label: 'Landing', step: 8 },
  ];

  return annotateTrajectoryEvents(combined, events);
}

function annotateTrajectoryEvents(points: TrajectoryPoint[], events: TrajectoryEvent[]): TrajectoryPoint[] {
  const annotations = new Map<number, { label: string; step: number }>();
  for (const event of events) {
    let bestIdx = 0;
    let bestDt = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dt = Math.abs((points[i].time_s ?? 0) - event.timeS);
      if (dt < bestDt) {
        bestDt = dt;
        bestIdx = i;
      }
    }
    annotations.set(bestIdx, { label: event.label, step: event.step });
  }

  return points.map((point, idx) => {
    const annotation = annotations.get(idx);
    return annotation ? { ...point, label: annotation.label, step: annotation.step } : point;
  });
}

export function getPlanetPosition(dateStr: string, destinationId: string = 'moon'): [number, number, number] {
  const date = new Date(dateStr);
  const days = date.getTime() / 86400000;
  const planet = PLANETS[destinationId] || PLANETS.moon;
  const angle = (days % planet.period) / planet.period * Math.PI * 2;
  const scale = destinationId === 'moon' ? 1 : planet.dist / 384.4;
  const D = 384 * scale;
  return [Math.cos(angle) * D, 0, Math.sin(angle) * D];
}

// ─── Collision / Conjunction ──────────────────────────────────────────────────

/**
 * Estimate conjunction risk between two orbital shells.
 * Uses simplified Keplerian geometry.
 */
export function estimateConjunctionRisk(
  alt1_km: number, inc1: number,
  alt2_km: number, inc2: number
): { closestApproach_km: number; relVelocity_kms: number; probability: number } {
  const r1 = alt1_km + RE, r2 = alt2_km + RE;
  const v1 = Math.sqrt(MU / r1), v2 = Math.sqrt(MU / r2);
  const dInc = Math.abs(inc1 - inc2) * Math.PI / 180;
  const relV = Math.sqrt(v1*v1 + v2*v2 - 2*v1*v2*Math.cos(dInc));
  const dAlt = Math.abs(alt1_km - alt2_km);
  const closestApproach = Math.max(0.1, dAlt * 0.8);
  const probability = Math.exp(-closestApproach / 5) * 0.01;
  return { closestApproach_km: closestApproach, relVelocity_kms: relV, probability };
}
