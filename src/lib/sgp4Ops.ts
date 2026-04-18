import * as satellite from 'satellite.js';

export interface TleInput {
  id: string;
  name: string;
  tle1: string;
  tle2: string;
  covarianceSigmaKm?: number;
}

export interface PropagatedTleState {
  id: string;
  name: string;
  epoch: string;
  positionKm: [number, number, number];
  velocityKmS: [number, number, number];
}

export interface Sgp4Conjunction {
  objectA: string;
  objectB: string;
  tcaIso: string;
  tcaSeconds: number;
  closestApproachKm: number;
  relativeVelocityKmS: number;
  collisionProbability: number;
}

export interface NavigationResidual {
  id: string;
  observedMinusPredictedKm: [number, number, number];
  observedMinusPredictedKmS: [number, number, number];
  positionResidualKm: number;
  velocityResidualKmS: number;
}

function mag(v: [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function propagateRecord(record: TleInput, when: Date): PropagatedTleState {
  const satrec = satellite.twoline2satrec(record.tle1, record.tle2);
  const pv = satellite.propagate(satrec, when);
  if (!pv.position || !pv.velocity) {
    throw new Error(`SGP4 propagation failed for ${record.id}`);
  }
  return {
    id: record.id,
    name: record.name,
    epoch: when.toISOString(),
    positionKm: [pv.position.x, pv.position.y, pv.position.z],
    velocityKmS: [pv.velocity.x, pv.velocity.y, pv.velocity.z],
  };
}

export function propagateTles(records: TleInput[], when: Date): PropagatedTleState[] {
  return records.map((record) => propagateRecord(record, when));
}

export function screenSgp4Conjunctions(params: {
  records: TleInput[];
  startTime: string;
  horizonMinutes?: number;
  stepSeconds?: number;
}): Sgp4Conjunction[] {
  const start = new Date(params.startTime);
  const horizonMinutes = params.horizonMinutes ?? 24 * 60;
  const stepSeconds = params.stepSeconds ?? 60;
  const conjunctions: Sgp4Conjunction[] = [];

  for (let i = 0; i < params.records.length; i++) {
    for (let j = i + 1; j < params.records.length; j++) {
      let bestDistance = Number.POSITIVE_INFINITY;
      let bestTime = 0;
      let bestRelVel = 0;
      for (let t = 0; t <= horizonMinutes * 60; t += stepSeconds) {
        const when = new Date(start.getTime() + t * 1000);
        const a = propagateRecord(params.records[i], when);
        const b = propagateRecord(params.records[j], when);
        const relR = sub(a.positionKm, b.positionKm);
        const relV = sub(a.velocityKmS, b.velocityKmS);
        const distance = mag(relR);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestTime = t;
          bestRelVel = mag(relV);
        }
      }
      const sigma = Math.max(0.2, Math.sqrt((params.records[i].covarianceSigmaKm ?? 1.5) ** 2 + (params.records[j].covarianceSigmaKm ?? 1.5) ** 2));
      const collisionProbability = Math.exp(-(bestDistance ** 2) / (2 * sigma ** 2));
      conjunctions.push({
        objectA: params.records[i].name,
        objectB: params.records[j].name,
        tcaIso: new Date(start.getTime() + bestTime * 1000).toISOString(),
        tcaSeconds: bestTime,
        closestApproachKm: bestDistance,
        relativeVelocityKmS: bestRelVel,
        collisionProbability,
      });
    }
  }

  return conjunctions.sort((a, b) => a.closestApproachKm - b.closestApproachKm).slice(0, 20);
}

export function computeNavigationResiduals(params: {
  predicted: PropagatedTleState[];
  observed: Array<{ id: string; positionKm: [number, number, number]; velocityKmS: [number, number, number] }>;
}): NavigationResidual[] {
  const observedById = new Map(params.observed.map((item) => [item.id, item]));
  return params.predicted
    .map((predicted) => {
      const observed = observedById.get(predicted.id);
      if (!observed) return null;
      const dr = sub(observed.positionKm, predicted.positionKm);
      const dv = sub(observed.velocityKmS, predicted.velocityKmS);
      return {
        id: predicted.id,
        observedMinusPredictedKm: dr,
        observedMinusPredictedKmS: dv,
        positionResidualKm: mag(dr),
        velocityResidualKmS: mag(dv),
      };
    })
    .filter((item): item is NavigationResidual => !!item);
}
