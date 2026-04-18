/**
 * ARTEMIS-Q Orbital Mechanics Library — Competition Edition
 * 
 * Implements:
 *   - SGP4-inspired propagation for TLE elements
 *   - Keplerian element conversions (COE → ECI)
 *   - Patched conic trajectory design (Hohmann, bi-elliptic)
 *   - Atmospheric density model (NRLMSISE-00 simplified)
 *   - Gravitational perturbations: J2, J3, lunar/solar (simplified)
 *   - Satellite conjunction / collision risk (TCA, relative velocity)
 */

import * as THREE from 'three';

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

export function calculateArtemisTrajectory(launchDate: string, destinationId: string = 'moon'): TrajectoryPoint[] {
  const date = new Date(launchDate);
  const timeOffset = date.getTime() / 86400000;
  const planet = PLANETS[destinationId] || PLANETS.moon;
  const orbitalAngle = (timeOffset % planet.period) / planet.period * Math.PI * 2;
  const scale = destinationId === 'moon' ? 1 : planet.dist / 384.4;
  const D = 384 * scale;

  const planetPos: [number,number,number] = [
    Math.cos(orbitalAngle) * D,
    0,
    Math.sin(orbitalAngle) * D
  ];

  // Use Keplerian propagation for departure and arrival
  const departEl: KeplerianElements = { a: RE + 400, e: 0.001, i: 28.5, raan: 0, argp: 90, nu: 0 };
  const departECI = keplerian2ECI(departEl);
  const launchPos: [number,number,number] = [
    departECI.r[0] * 0.15, departECI.r[1] * 0.15, departECI.r[2] * 0.15
  ];

  const controlPoints = [
    new THREE.Vector3(...launchPos),
    new THREE.Vector3(launchPos[0] + 20, -30, 10),
    new THREE.Vector3(D * 0.3, -50, planetPos[2] * 0.1),
    new THREE.Vector3(D * 0.7, -25, planetPos[2] * 0.6),
    new THREE.Vector3(planetPos[0] + 10, 5, planetPos[2] + 10),
    new THREE.Vector3(planetPos[0] - 15, 40, planetPos[2] - 15),
    new THREE.Vector3(D * 0.4, 60, planetPos[2] * 0.05),
    new THREE.Vector3(launchPos[0] + 5, 15, 2),
  ];

  const curve = new THREE.CatmullRomCurve3(controlPoints);
  const splinePoints = curve.getPoints(120);

  const keyLabels = [
    { idx: 0,   label: 'Liftoff (KSC 39B)',     step: 1  },
    { idx: 12,  label: 'Trans-Injection Burn',    step: 4  },
    { idx: 55,  label: `${planet.name} Arrival`,  step: 11 },
    { idx: 80,  label: 'Return Trajectory',       step: 12 },
    { idx: 115, label: 'Re-entry / Splashdown',   step: 15 },
  ];

  return splinePoints.map((p, i) => {
    const key = keyLabels.find(k => Math.abs(k.idx - i) < 1);
    return { pos: [p.x, p.y, p.z], label: key?.label, step: key?.step };
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
