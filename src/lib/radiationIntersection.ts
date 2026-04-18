import type { RadiationEnvironment } from './radiationModel';

export interface RadiationTrajectoryPoint {
  pos: [number, number, number];
  time_s?: number;
}

export interface RadiationZoneIntersection {
  label: string;
  severity: number;
  entered: boolean;
  samplesInside: number;
  peakRadiusKm: number;
  traversedDistanceKm: number;
  weightedExposureScore: number;
}

export interface RadiationIntersectionAssessment {
  totalTraversedDistanceKm: number;
  totalWeightedExposureScore: number;
  normalizedRiskIndex: number;
  maxZoneSeverity: number;
  crossings: number;
  zoneIntersections: RadiationZoneIntersection[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function radiusKm(point: RadiationTrajectoryPoint): number {
  return Math.hypot(point.pos[0], point.pos[1], point.pos[2]);
}

function distanceKm(a: RadiationTrajectoryPoint, b: RadiationTrajectoryPoint): number {
  return Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
}

function isInsideZone(rKm: number, zone: RadiationEnvironment['zones'][number]): boolean {
  return rKm >= zone.innerRadiusKm && rKm <= zone.outerRadiusKm;
}

export function assessTrajectoryRadiationIntersections(
  trajectory: RadiationTrajectoryPoint[],
  environment: RadiationEnvironment,
): RadiationIntersectionAssessment {
  if (trajectory.length < 2) {
    return {
      totalTraversedDistanceKm: 0,
      totalWeightedExposureScore: 0,
      normalizedRiskIndex: 1,
      maxZoneSeverity: 0,
      crossings: 0,
      zoneIntersections: environment.zones.map((zone) => ({
        label: zone.label,
        severity: zone.severity,
        entered: false,
        samplesInside: 0,
        peakRadiusKm: 0,
        traversedDistanceKm: 0,
        weightedExposureScore: 0,
      })),
    };
  }

  let totalWeightedExposureScore = 0;
  let crossings = 0;

  const zoneIntersections = environment.zones.map((zone) => {
    let samplesInside = 0;
    let traversedDistanceKm = 0;
    let weightedExposureScore = 0;
    let peakRadiusKm = 0;
    let entered = false;
    let wasInside = false;

    for (let i = 0; i < trajectory.length; i++) {
      const point = trajectory[i];
      const r = radiusKm(point);
      const inside = isInsideZone(r, zone);
      if (inside) {
        samplesInside += 1;
        peakRadiusKm = Math.max(peakRadiusKm, r);
        if (!wasInside) {
          crossings += 1;
          entered = true;
        }
      }
      if (i > 0) {
        const segDistance = distanceKm(trajectory[i - 1], point);
        const prevInside = isInsideZone(radiusKm(trajectory[i - 1]), zone);
        if (inside || prevInside) {
          traversedDistanceKm += segDistance;
          const exposure = segDistance * zone.severity;
          weightedExposureScore += exposure;
          totalWeightedExposureScore += exposure;
        }
      }
      wasInside = inside;
    }

    return {
      label: zone.label,
      severity: zone.severity,
      entered,
      samplesInside,
      peakRadiusKm,
      traversedDistanceKm,
      weightedExposureScore,
    };
  });
  const totalTraversedDistanceKm = zoneIntersections.reduce((sum, item) => sum + item.traversedDistanceKm, 0);

  const maxZoneSeverity = zoneIntersections.reduce((max, item) => Math.max(max, item.entered ? item.severity : 0), 0);
  const normalizedRiskIndex = clamp(
    1 + totalWeightedExposureScore / 250000 + maxZoneSeverity * 0.08 + crossings * 0.04,
    1,
    6,
  );

  return {
    totalTraversedDistanceKm,
    totalWeightedExposureScore,
    normalizedRiskIndex,
    maxZoneSeverity,
    crossings,
    zoneIntersections,
  };
}
