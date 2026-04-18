import type { TrajectoryPoint } from './orbital';
import { AU_KM, CELESTIAL_BODIES, MU_SUN_KM3S2, type CelestialBody } from './celestial';

export interface GravityInfluenceAssessment {
  bodyId: string;
  bodyName: string;
  closestApproachKm: number;
  sphereOfInfluenceKm: number;
  minTidalAccelerationMs2: number;
  maxTidalAccelerationMs2: number;
  influenceRatio: number;
  willInfluence: boolean;
}

function distanceKm(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function sphereOfInfluenceKm(body: CelestialBody): number {
  const aKm = body.orbit ? body.orbit.semiMajorAxisAu * AU_KM : 384400;
  return aKm * Math.pow(body.muKm3s2 / MU_SUN_KM3S2, 2 / 5);
}

function tidalAccelerationMs2(body: CelestialBody, separationKm: number): number {
  const r = Math.max(separationKm * 1000, 1);
  return 2 * body.muKm3s2 * 1e9 / (r * r * r);
}

export function assessTrajectoryGravityInfluence(
  trajectory: TrajectoryPoint[],
  bodyPositions: Array<{ id: string; name: string; posKm: [number, number, number] }>,
): GravityInfluenceAssessment[] {
  const bodyMap = new Map(CELESTIAL_BODIES.map((body) => [body.id, body]));
  const results: GravityInfluenceAssessment[] = [];

  for (const body of bodyPositions) {
    const local = bodyMap.get(body.id);
    if (!local) continue;
    let closest = Number.POSITIVE_INFINITY;
    let minAccel = Number.POSITIVE_INFINITY;
    let maxAccel = 0;
    for (const point of trajectory) {
      const d = distanceKm(point.pos, body.posKm);
      closest = Math.min(closest, d);
      const accel = tidalAccelerationMs2(local, d);
      minAccel = Math.min(minAccel, accel);
      maxAccel = Math.max(maxAccel, accel);
    }
    const soi = sphereOfInfluenceKm(local);
    const influenceRatio = soi > 0 ? soi / Math.max(closest, 1) : 0;
    results.push({
      bodyId: body.id,
      bodyName: body.name,
      closestApproachKm: closest,
      sphereOfInfluenceKm: soi,
      minTidalAccelerationMs2: Number.isFinite(minAccel) ? minAccel : 0,
      maxTidalAccelerationMs2: maxAccel,
      influenceRatio,
      willInfluence: closest <= soi || influenceRatio > 0.35,
    });
  }

  return results.sort((a, b) => b.influenceRatio - a.influenceRatio);
}
