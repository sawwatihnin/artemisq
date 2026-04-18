/**
 * Reduced-order ascent / aerodynamics helpers (real-time, deterministic).
 * Exponential atmosphere, dynamic pressure, drag, Mach-dependent Cd scaling, stability heuristics.
 */

import { tsiolkovskyFuelMass } from './optimizer';

export const RHO0_SEA_LEVEL = 1.225; // kg/m³
export const SCALE_HEIGHT_EARTH_M = 8500; // m (≈ 8.5 km)

/** ρ(h) = ρ₀ exp(-h / H) */
export function exponentialDensity(h_m: number, rho0 = RHO0_SEA_LEVEL, scaleHeightM = SCALE_HEIGHT_EARTH_M): number {
  return rho0 * Math.exp(-Math.max(0, h_m) / scaleHeightM);
}

/** q = ½ ρ v² (Pa) */
export function dynamicPressurePa(rho_kg_m3: number, speed_ms: number): number {
  return 0.5 * rho_kg_m3 * speed_ms * speed_ms;
}

/** |D| = ½ ρ v² Cd A (N) */
export function dragForceN(rho_kg_m3: number, speed_ms: number, cd: number, area_m2: number): number {
  return 0.5 * rho_kg_m3 * speed_ms * speed_ms * cd * area_m2;
}

/** Simple troposphere temperature for speed of sound (K). */
export function isaTemperatureK(altitudeM: number): number {
  const L = 0.0065;
  const T0 = 288.15;
  if (altitudeM <= 11000) return Math.max(150, T0 - L * altitudeM);
  if (altitudeM <= 20000) return 216.65;
  return 216.65;
}

export function speedOfSoundMs(tempK: number, gamma = 1.4, R = 287.05): number {
  return Math.sqrt(Math.max(1, gamma * R * tempK));
}

/** Piecewise Cd multiplier vs Mach (subsonic / transonic bump / supersonic decay). */
export function cdMachMultiplier(mach: number): number {
  const m = Math.max(0, mach);
  if (m < 0.8) return 1.0;
  if (m < 1.2) {
    // smooth bump through transonic
    const t = (m - 0.8) / 0.4;
    return 1.0 + 0.22 * Math.sin((t * Math.PI) / 2);
  }
  if (m < 3) return 1.22 - (m - 1.2) * 0.08;
  return Math.max(0.75, 0.964 - (m - 3) * 0.02);
}

export interface GeometryStabilityHints {
  /** Length / max(width, depth) from bounding box (fineness). */
  aspectRatio: number;
  /** |x_cp − x_com| / referenceLength, dimensionless (0 = aligned). */
  cpComOffsetNorm: number;
  referenceLengthM: number;
}

export interface StabilityHeuristicInput {
  maxQ_kPa: number;
  maxQThreshold_kPa: number;
  peakAccelG: number;
  minMassDuringAscent_kg: number;
  peakDragN: number;
  geometry?: GeometryStabilityHints | null;
}

export type AscentStabilityFlag = 'Max Q risk' | 'structural load risk' | 'instability risk';

export function assessAscentStability(input: StabilityHeuristicInput): {
  score: number;
  flags: AscentStabilityFlag[];
} {
  const flags: AscentStabilityFlag[] = [];
  const { maxQ_kPa, maxQThreshold_kPa, peakAccelG, minMassDuringAscent_kg, peakDragN, geometry } = input;

  if (maxQ_kPa > maxQThreshold_kPa * 0.92) flags.push('Max Q risk');
  const loadProxy = maxQ_kPa * 1.2 + (peakDragN / Math.max(5000, minMassDuringAscent_kg)) * 8;
  if (loadProxy > maxQThreshold_kPa * 1.35 || peakAccelG > 5.8) flags.push('structural load risk');

  let instability = 0;
  if (geometry) {
    if (geometry.aspectRatio < 4) instability += 18;
    if (geometry.aspectRatio < 2.5) instability += 12;
    instability += Math.min(25, geometry.cpComOffsetNorm * 120);
  }
  if (peakAccelG > 4 && minMassDuringAscent_kg < 8000) instability += 10;
  if (instability > 22 || (geometry && geometry.aspectRatio < 3.5 && maxQ_kPa > maxQThreshold_kPa * 0.75)) {
    flags.push('instability risk');
  }

  let score = 100;
  score -= Math.max(0, maxQ_kPa - maxQThreshold_kPa) * 2.1;
  score -= Math.max(0, peakAccelG - 4.5) * 9;
  score -= Math.max(0, peakDragN / Math.max(1, minMassDuringAscent_kg) - 0.35) * 22;
  score -= instability * 0.85;
  score = Math.max(0, Math.min(100, score));

  return { score, flags: [...new Set(flags)] };
}

/** Propellant mass consistent with rocket equation (same helper as Fuel / Tsiolkovsky panel). */
export function propellantMassFromDeltaV(m0_kg: number, deltaV_ms: number, ispVac_s: number): number {
  return tsiolkovskyFuelMass(deltaV_ms, m0_kg, ispVac_s);
}
