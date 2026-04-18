export interface OrbitalElementsApprox {
  semiMajorAxisAu: number;
  eccentricity: number;
  inclinationDeg: number;
  longitudeAscendingNodeDeg: number;
  longitudePerihelionDeg: number;
  meanLongitudeDeg: number;
  periodDays: number;
}

export interface CelestialBody {
  id: string;
  name: string;
  category: 'planet' | 'moon' | 'dwarf-planet';
  radiusKm: number;
  muKm3s2: number;
  standardGravity: number;
  rotationPeriodHours: number;
  flattening: number;
  atmosphereScaleHeightKm?: number;
  color: string;
  orbit?: OrbitalElementsApprox;
  parentId?: string;
}

export const AU_KM = 149597870.7;
export const MU_SUN_KM3S2 = 132712440018;
export const HELIOCENTRIC_DISPLAY_SCALE_KM = AU_KM / 1500000;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0, 0);

export const CELESTIAL_BODIES: CelestialBody[] = [
  {
    id: 'mercury',
    name: 'Mercury',
    category: 'planet',
    radiusKm: 2439.7,
    muKm3s2: 22032.1,
    standardGravity: 3.7,
    rotationPeriodHours: 1407.6,
    flattening: 0,
    color: '#b7b1a7',
    orbit: { semiMajorAxisAu: 0.387098, eccentricity: 0.20563, inclinationDeg: 7.005, longitudeAscendingNodeDeg: 48.331, longitudePerihelionDeg: 77.456, meanLongitudeDeg: 252.251, periodDays: 87.969 },
  },
  {
    id: 'venus',
    name: 'Venus',
    category: 'planet',
    radiusKm: 6051.8,
    muKm3s2: 324859,
    standardGravity: 8.87,
    rotationPeriodHours: -5832.5,
    flattening: 0,
    atmosphereScaleHeightKm: 15.9,
    color: '#d9b16f',
    orbit: { semiMajorAxisAu: 0.723332, eccentricity: 0.006772, inclinationDeg: 3.39458, longitudeAscendingNodeDeg: 76.68, longitudePerihelionDeg: 131.53298, meanLongitudeDeg: 181.97973, periodDays: 224.701 },
  },
  {
    id: 'earth',
    name: 'Earth',
    category: 'planet',
    radiusKm: 6378.137,
    muKm3s2: 398600.4418,
    standardGravity: 9.80665,
    rotationPeriodHours: 23.9345,
    flattening: 1 / 298.257223563,
    atmosphereScaleHeightKm: 8.5,
    color: '#4B9CD3',
    orbit: { semiMajorAxisAu: 1.00000011, eccentricity: 0.01671022, inclinationDeg: 0.00005, longitudeAscendingNodeDeg: -11.26064, longitudePerihelionDeg: 102.94719, meanLongitudeDeg: 100.46435, periodDays: 365.256 },
  },
  {
    id: 'moon',
    name: 'Moon',
    category: 'moon',
    radiusKm: 1737.4,
    muKm3s2: 4902.8001,
    standardGravity: 1.62,
    rotationPeriodHours: 655.72,
    flattening: 0.0012,
    color: '#bfc2c7',
    parentId: 'earth',
  },
  {
    id: 'mars',
    name: 'Mars',
    category: 'planet',
    radiusKm: 3389.5,
    muKm3s2: 42828.37,
    standardGravity: 3.721,
    rotationPeriodHours: 24.6229,
    flattening: 0.00589,
    atmosphereScaleHeightKm: 11.1,
    color: '#c66b4d',
    orbit: { semiMajorAxisAu: 1.523679, eccentricity: 0.0934, inclinationDeg: 1.85, longitudeAscendingNodeDeg: 49.558, longitudePerihelionDeg: 336.04084, meanLongitudeDeg: 355.45332, periodDays: 686.98 },
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    category: 'planet',
    radiusKm: 69911,
    muKm3s2: 126686534,
    standardGravity: 24.79,
    rotationPeriodHours: 9.925,
    flattening: 0.06487,
    color: '#d5a06d',
    orbit: { semiMajorAxisAu: 5.20260, eccentricity: 0.04849, inclinationDeg: 1.303, longitudeAscendingNodeDeg: 100.464, longitudePerihelionDeg: 14.331, meanLongitudeDeg: 34.40438, periodDays: 4332.59 },
  },
  {
    id: 'saturn',
    name: 'Saturn',
    category: 'planet',
    radiusKm: 58232,
    muKm3s2: 37931207.8,
    standardGravity: 10.44,
    rotationPeriodHours: 10.656,
    flattening: 0.09796,
    color: '#d9c38a',
    orbit: { semiMajorAxisAu: 9.5549, eccentricity: 0.0555, inclinationDeg: 2.485, longitudeAscendingNodeDeg: 113.665, longitudePerihelionDeg: 93.057, meanLongitudeDeg: 49.94432, periodDays: 10759.22 },
  },
  {
    id: 'uranus',
    name: 'Uranus',
    category: 'planet',
    radiusKm: 25362,
    muKm3s2: 5793951.3,
    standardGravity: 8.69,
    rotationPeriodHours: -17.24,
    flattening: 0.02293,
    color: '#7ec7d7',
    orbit: { semiMajorAxisAu: 19.2184, eccentricity: 0.0463, inclinationDeg: 0.773, longitudeAscendingNodeDeg: 74.006, longitudePerihelionDeg: 173.005, meanLongitudeDeg: 313.23218, periodDays: 30688.5 },
  },
  {
    id: 'neptune',
    name: 'Neptune',
    category: 'planet',
    radiusKm: 24622,
    muKm3s2: 6836529,
    standardGravity: 11.15,
    rotationPeriodHours: 16.11,
    flattening: 0.0171,
    color: '#5a81f0',
    orbit: { semiMajorAxisAu: 30.11, eccentricity: 0.009456, inclinationDeg: 1.77, longitudeAscendingNodeDeg: 131.784, longitudePerihelionDeg: 48.123, meanLongitudeDeg: 304.88003, periodDays: 60182 },
  },
  {
    id: 'pluto',
    name: 'Pluto',
    category: 'dwarf-planet',
    radiusKm: 1188.3,
    muKm3s2: 872.4,
    standardGravity: 0.62,
    rotationPeriodHours: -153.3,
    flattening: 0,
    color: '#bca48b',
    orbit: { semiMajorAxisAu: 39.482, eccentricity: 0.2488, inclinationDeg: 17.16, longitudeAscendingNodeDeg: 110.299, longitudePerihelionDeg: 224.066, meanLongitudeDeg: 238.92881, periodDays: 90560 },
  },
];

export const CELESTIAL_BODY_MAP = Object.fromEntries(CELESTIAL_BODIES.map((body) => [body.id, body])) as Record<string, CelestialBody>;

/** Sun–body distance from the same approximate Kepler model as the display orbit (r in km, not display-scaled). */
export function getHeliocentricOrbitalRadiusKm(body: CelestialBody, date: Date): number | null {
  if (!body.orbit) return null;
  const daysFromJ2000 = (date.getTime() - J2000_MS) / 86400000;
  const orbit = body.orbit;
  const meanAnomalyDeg = orbit.meanLongitudeDeg - orbit.longitudePerihelionDeg + (daysFromJ2000 / orbit.periodDays) * 360;
  const M = ((meanAnomalyDeg % 360) * Math.PI) / 180;
  let E = M;
  for (let i = 0; i < 8; i++) {
    E = E - (E - orbit.eccentricity * Math.sin(E) - M) / (1 - orbit.eccentricity * Math.cos(E));
  }
  const rAu = orbit.semiMajorAxisAu * (1 - orbit.eccentricity * Math.cos(E));
  return rAu * AU_KM;
}

export function searchBodies(query: string): CelestialBody[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return CELESTIAL_BODIES;
  return CELESTIAL_BODIES.filter((body) => body.name.toLowerCase().includes(normalized) || body.id.includes(normalized));
}

export function getBodyLocalGravity(body: CelestialBody, latitudeDeg: number, altitudeKm: number): number {
  const radiusMeters = (body.radiusKm + altitudeKm) * 1000;
  const muMeters = body.muKm3s2 * 1e9;
  const latitudeRad = (latitudeDeg * Math.PI) / 180;
  const gravityNewtonian = muMeters / (radiusMeters * radiusMeters);
  if (!body.rotationPeriodHours) return gravityNewtonian;
  const omega = (2 * Math.PI) / Math.abs(body.rotationPeriodHours * 3600);
  const centrifugal = omega * omega * radiusMeters * Math.cos(latitudeRad) * Math.cos(latitudeRad);
  return Math.max(0, gravityNewtonian - centrifugal);
}

export function getDateAdjustedLocalGravity(
  body: CelestialBody,
  latitudeDeg: number,
  longitudeDeg: number,
  altitudeKm: number,
  date: Date,
): number {
  const baseGravity = getBodyLocalGravity(body, latitudeDeg, altitudeKm);
  if (!body.orbit) return baseGravity;

  const radiusMeters = (body.radiusKm + altitudeKm) * 1000;
  const bodyDistanceMeters = Math.max(1, (getHeliocentricOrbitalRadiusKm(body, date) ?? AU_KM) * 1000);

  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;
  const localHourAngle = (((utcHours * 15 + longitudeDeg) % 360) * Math.PI) / 180;
  const latitudeRad = (latitudeDeg * Math.PI) / 180;
  const solarProjection = Math.cos(latitudeRad) * Math.cos(localHourAngle);

  const solarTidalAcceleration =
    2 * (MU_SUN_KM3S2 * 1e9) * radiusMeters * solarProjection / Math.pow(bodyDistanceMeters, 3);

  return Math.max(0, baseGravity + solarTidalAcceleration);
}

export function getApproximateHeliocentricPosition(body: CelestialBody, date: Date): [number, number, number] {
  if (!body.orbit) return [0, 0, 0];
  const daysFromJ2000 = (date.getTime() - J2000_MS) / 86400000;
  const orbit = body.orbit;
  const meanMotion = (2 * Math.PI) / orbit.periodDays;
  const meanAnomalyDeg = orbit.meanLongitudeDeg - orbit.longitudePerihelionDeg + (daysFromJ2000 / orbit.periodDays) * 360;
  const M = ((meanAnomalyDeg % 360) * Math.PI) / 180;
  let E = M;
  for (let i = 0; i < 8; i++) {
    E = E - (E - orbit.eccentricity * Math.sin(E) - M) / (1 - orbit.eccentricity * Math.cos(E));
  }
  const nu = 2 * Math.atan2(
    Math.sqrt(1 + orbit.eccentricity) * Math.sin(E / 2),
    Math.sqrt(1 - orbit.eccentricity) * Math.cos(E / 2),
  );
  const r = orbit.semiMajorAxisAu * (1 - orbit.eccentricity * Math.cos(E));

  const i = (orbit.inclinationDeg * Math.PI) / 180;
  const omega = ((orbit.longitudePerihelionDeg - orbit.longitudeAscendingNodeDeg) * Math.PI) / 180;
  const Omega = (orbit.longitudeAscendingNodeDeg * Math.PI) / 180;
  const xOrb = r * Math.cos(nu);
  const yOrb = r * Math.sin(nu);

  const cosO = Math.cos(Omega);
  const sinO = Math.sin(Omega);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const cosW = Math.cos(omega);
  const sinW = Math.sin(omega);

  const x =
    xOrb * (cosO * cosW - sinO * sinW * cosI) -
    yOrb * (cosO * sinW + sinO * cosW * cosI);
  const y =
    xOrb * (sinO * cosW + cosO * sinW * cosI) -
    yOrb * (sinO * sinW - cosO * cosW * cosI);
  const z = xOrb * (sinW * sinI) + yOrb * (cosW * sinI);

  return [x * HELIOCENTRIC_DISPLAY_SCALE_KM, z * HELIOCENTRIC_DISPLAY_SCALE_KM, y * HELIOCENTRIC_DISPLAY_SCALE_KM];
}

export function getApproximateHeliocentricVelocity(body: CelestialBody, date: Date, dtDays = 1): [number, number, number] {
  const before = getApproximateHeliocentricPosition(body, new Date(date.getTime() - dtDays * 86400000));
  const after = getApproximateHeliocentricPosition(body, new Date(date.getTime() + dtDays * 86400000));
  const dtSeconds = dtDays * 86400 * 2;
  return [
    (after[0] - before[0]) / dtSeconds,
    (after[1] - before[1]) / dtSeconds,
    (after[2] - before[2]) / dtSeconds,
  ];
}
