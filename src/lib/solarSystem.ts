import { CELESTIAL_BODIES, CELESTIAL_BODY_MAP, type CelestialBody } from './celestial';

const SOLAR_SYSTEM_BASE = 'https://api.le-systeme-solaire.net/rest';
const SOLAR_SYSTEM_TOKEN = process.env.SOLAR_SYSTEM_OPENDATA_TOKEN ?? '';

export interface SolarBodyRecord {
  id: string;
  name?: string;
  englishName?: string;
  isPlanet?: boolean;
  bodyType?: string;
  gravity?: number;
  meanRadius?: number;
  equaRadius?: number;
  polarRadius?: number;
  semimajorAxis?: number;
  sideralOrbit?: number;
  sideralRotation?: number;
  eccentricity?: number;
  inclination?: number;
  axialTilt?: number;
  avgTemp?: number;
  aroundPlanet?: { planet?: string; rel?: string };
  moons?: Array<{ moon: string; rel: string }>;
  mass?: { massValue?: number; massExponent?: number };
}

interface SolarBodiesResponse {
  bodies?: SolarBodyRecord[];
}

export interface SolarSkyPosition {
  name: string;
  ra: string;
  dec: string;
  az: string;
  alt: string;
}

function authHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'ARTEMIS-Q/1.0 (local mission console)',
  };
  if (SOLAR_SYSTEM_TOKEN) {
    headers.Authorization = `Bearer ${SOLAR_SYSTEM_TOKEN}`;
  }
  return headers;
}

function fallbackBodies(): SolarBodyRecord[] {
  return CELESTIAL_BODIES.map((body) => ({
    id: body.id,
    name: body.name,
    englishName: body.name,
    isPlanet: body.category === 'planet',
    bodyType: body.category === 'dwarf-planet' ? 'Dwarf Planet' : body.category[0].toUpperCase() + body.category.slice(1),
    gravity: body.standardGravity,
    meanRadius: body.radiusKm,
    equaRadius: body.radiusKm,
    polarRadius: body.radiusKm * (1 - body.flattening),
    semimajorAxis: body.orbit ? body.orbit.semiMajorAxisAu * 149597870.7 : undefined,
    sideralOrbit: body.orbit?.periodDays,
    sideralRotation: body.rotationPeriodHours,
    eccentricity: body.orbit?.eccentricity,
    inclination: body.orbit?.inclinationDeg,
    axialTilt: undefined,
    avgTemp: undefined,
    aroundPlanet: body.parentId ? { planet: CELESTIAL_BODY_MAP[body.parentId]?.name } : undefined,
  }));
}

export async function fetchSolarBodies(): Promise<SolarBodyRecord[]> {
  if (!SOLAR_SYSTEM_TOKEN) return fallbackBodies();
  const response = await fetch(`${SOLAR_SYSTEM_BASE}/bodies/`, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`Solar System OpenData HTTP ${response.status}`);
  }
  const payload = await response.json() as SolarBodiesResponse;
  return payload.bodies ?? [];
}

export async function fetchSolarBody(id: string): Promise<SolarBodyRecord | null> {
  if (!SOLAR_SYSTEM_TOKEN) {
    return fallbackBodies().find((body) => body.id === id.toLowerCase()) ?? null;
  }
  const response = await fetch(`${SOLAR_SYSTEM_BASE}/bodies/${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`Solar System OpenData HTTP ${response.status}`);
  }
  return response.json() as Promise<SolarBodyRecord>;
}

export async function fetchSolarSkyPositions(params: {
  lon: number;
  lat: number;
  elev?: number;
  datetime: string;
  zone?: number;
}): Promise<SolarSkyPosition[]> {
  if (!SOLAR_SYSTEM_TOKEN) return [];
  const url = new URL(`${SOLAR_SYSTEM_BASE}/positions`);
  url.searchParams.set('lon', String(params.lon));
  url.searchParams.set('lat', String(params.lat));
  url.searchParams.set('elev', String(params.elev ?? 0));
  url.searchParams.set('datetime', params.datetime);
  url.searchParams.set('zone', String(params.zone ?? 0));
  const response = await fetch(url.toString(), { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`Solar System OpenData positions HTTP ${response.status}`);
  }
  return response.json() as Promise<SolarSkyPosition[]>;
}

export function mergeCelestialFallback(liveBodies: SolarBodyRecord[]): Array<SolarBodyRecord & { color?: string; atmosphereScaleHeightKm?: number }> {
  const fallback = new Map(CELESTIAL_BODIES.map((body) => [body.id, body]));
  return liveBodies.map((body) => {
    const local = fallback.get(body.id);
    return {
      ...body,
      color: local?.color,
      atmosphereScaleHeightKm: local?.atmosphereScaleHeightKm,
    };
  });
}
