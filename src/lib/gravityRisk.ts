import { CELESTIAL_BODY_MAP, type CelestialBody } from './celestial';
import type { OptimizerNode } from './optimizer';

export interface GravityNodeInfluence {
  bodyId: string;
  bodyName: string;
  localGravityMs2: number;
  escapeVelocityMs: number;
  sphereOfInfluenceFraction: number;
  riskPenalty: number;
  fuelPenaltyFraction: number;
  assistBonusFraction: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function inferDominantBody(node: OptimizerNode): CelestialBody {
  const key = `${node.id} ${node.name}`.toLowerCase();
  if (/\bmoon\b|luna|lunar|nrho|loi|eml|gateway|lagrange|l1/.test(key)) return CELESTIAL_BODY_MAP.moon;
  if (/\bmars\b/.test(key)) return CELESTIAL_BODY_MAP.mars;
  if (/\bvenus\b/.test(key)) return CELESTIAL_BODY_MAP.venus;
  if (/\bjupiter\b/.test(key)) return CELESTIAL_BODY_MAP.jupiter;
  if (/\bsaturn\b/.test(key)) return CELESTIAL_BODY_MAP.saturn;
  if (/\buranus\b/.test(key)) return CELESTIAL_BODY_MAP.uranus;
  if (/\bneptune\b/.test(key)) return CELESTIAL_BODY_MAP.neptune;
  if (/\bmercury\b/.test(key)) return CELESTIAL_BODY_MAP.mercury;
  if (/\bpluto\b/.test(key)) return CELESTIAL_BODY_MAP.pluto;
  return CELESTIAL_BODY_MAP.earth;
}

function inferAltitudeAboveBodyKm(node: OptimizerNode, body: CelestialBody): number {
  const rawAltitude = Math.max(node.altitude_km ?? 0, 0);
  if (body.id === 'earth') return rawAltitude;
  if (body.id === 'moon') return Math.max(rawAltitude - 384400, 0);
  return rawAltitude;
}

function sphereOfInfluenceFraction(body: CelestialBody, altitudeAboveBodyKm: number): number {
  const radius = Math.max(body.radiusKm + altitudeAboveBodyKm, body.radiusKm + 1);
  const referenceRadius =
    body.id === 'earth'
      ? 924000
      : body.id === 'moon'
        ? 66100
        : body.radiusKm * 80;
  return clamp(referenceRadius / radius, 0, 1.6);
}

function inferAssistBonus(node: OptimizerNode, body: CelestialBody, soiFraction: number): number {
  const key = `${node.id} ${node.name}`.toLowerCase();
  const assistCue = /flyby|gateway|lagrange|slingshot|assist|transfer|approach/.test(key);
  if (!assistCue) return 0;
  const baseBonus =
    body.id === 'moon'
      ? 0.07
      : body.id === 'earth'
        ? 0.025
        : body.id === 'jupiter'
          ? 0.09
          : 0.045;
  return clamp(baseBonus * soiFraction, 0, 0.12);
}

export function computeNodeGravityInfluence(node: OptimizerNode): GravityNodeInfluence {
  const body = inferDominantBody(node);
  const altitudeAboveBodyKm = inferAltitudeAboveBodyKm(node, body);
  const radiusKm = Math.max(body.radiusKm + altitudeAboveBodyKm, body.radiusKm + 1);
  const localGravityMs2 = (body.muKm3s2 * 1000) / (radiusKm * radiusKm);
  const escapeVelocityMs = Math.sqrt((2 * body.muKm3s2) / radiusKm) * 1000;
  const soiFraction = sphereOfInfluenceFraction(body, altitudeAboveBodyKm);
  const assistBonusFraction = inferAssistBonus(node, body, soiFraction);
  const gLoadTerm = localGravityMs2 / 9.80665;
  const velocityTerm = escapeVelocityMs / 11186;
  const riskPenalty = clamp(0.11 * soiFraction + 0.05 * gLoadTerm + 0.04 * velocityTerm - 0.45 * assistBonusFraction, 0, 0.45);
  const fuelPenaltyFraction = clamp(0.06 * soiFraction + 0.03 * velocityTerm - 0.5 * assistBonusFraction, 0, 0.28);

  return {
    bodyId: body.id,
    bodyName: body.name,
    localGravityMs2,
    escapeVelocityMs,
    sphereOfInfluenceFraction: soiFraction,
    riskPenalty,
    fuelPenaltyFraction,
    assistBonusFraction,
  };
}

export function summarizePathGravityExposure(path: string[], nodes: Map<string, OptimizerNode>) {
  const samples = path
    .map((id) => nodes.get(id))
    .filter((node): node is OptimizerNode => !!node)
    .map((node) => ({
      nodeId: node.id,
      nodeName: node.name,
      ...computeNodeGravityInfluence(node),
    }));

  const averageRiskPenalty = samples.length
    ? samples.reduce((sum, item) => sum + item.riskPenalty, 0) / samples.length
    : 0;
  const averageFuelPenalty = samples.length
    ? samples.reduce((sum, item) => sum + item.fuelPenaltyFraction, 0) / samples.length
    : 0;
  const strongest = [...samples].sort((a, b) => b.riskPenalty - a.riskPenalty)[0] ?? null;

  return {
    samples,
    averageRiskPenalty,
    averageFuelPenalty,
    dominantBodyId: strongest?.bodyId ?? null,
    dominantBodyName: strongest?.bodyName ?? null,
    maxRiskPenalty: strongest?.riskPenalty ?? 0,
  };
}
