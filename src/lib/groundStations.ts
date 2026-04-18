import { fetchHorizonsVectors, getHorizonsMajorBodyId, type HorizonsVectorRow } from './horizons';

export interface GroundStation {
  id: string;
  name: string;
  latDeg: number;
  lonDeg: number;
  altitudeKm: number;
  network: 'DSN';
}

export interface VisibilityWindow {
  stationId: string;
  stationName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  maxElevationDeg: number;
}

export interface GroundStationVisibilitySummary {
  stations: GroundStation[];
  windows: VisibilityWindow[];
  source: string;
}

export const DSN_STATIONS: GroundStation[] = [
  { id: 'DSS-GDSCC', name: 'Goldstone', latDeg: 35.2472, lonDeg: -116.7933, altitudeKm: 1.0, network: 'DSN' },
  { id: 'DSS-MDSCC', name: 'Madrid', latDeg: 40.4314, lonDeg: -4.2486, altitudeKm: 0.7, network: 'DSN' },
  { id: 'DSS-CDSCC', name: 'Canberra', latDeg: -35.3985, lonDeg: 148.9819, altitudeKm: 0.7, network: 'DSN' },
];

function deg2rad(value: number): number {
  return (value * Math.PI) / 180;
}

function gmstRadians(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const gmstDeg = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - (T * T * T) / 38710000;
  return deg2rad(((gmstDeg % 360) + 360) % 360);
}

function stationEciKm(station: GroundStation, date: Date): [number, number, number] {
  const earthRadiusKm = 6378.137 + station.altitudeKm;
  const lat = deg2rad(station.latDeg);
  const lon = deg2rad(station.lonDeg) + gmstRadians(date);
  const cosLat = Math.cos(lat);
  return [
    earthRadiusKm * cosLat * Math.cos(lon),
    earthRadiusKm * cosLat * Math.sin(lon),
    earthRadiusKm * Math.sin(lat),
  ];
}

function elevationDeg(station: GroundStation, target: HorizonsVectorRow): number {
  const date = new Date((target.jd - 2440587.5) * 86400000);
  const stationVec = stationEciKm(station, date);
  const range = [
    target.x - stationVec[0],
    target.y - stationVec[1],
    target.z - stationVec[2],
  ];
  const rangeNorm = Math.hypot(range[0], range[1], range[2]);
  const stationNorm = Math.hypot(stationVec[0], stationVec[1], stationVec[2]);
  const zenith = [stationVec[0] / stationNorm, stationVec[1] / stationNorm, stationVec[2] / stationNorm];
  const los = [range[0] / rangeNorm, range[1] / rangeNorm, range[2] / rangeNorm];
  return Math.asin(zenith[0] * los[0] + zenith[1] * los[1] + zenith[2] * los[2]) * (180 / Math.PI);
}

export async function computeDsnVisibility(params: {
  targetId: string;
  startTime: string;
  stopTime: string;
  stepSize?: string;
  minElevationDeg?: number;
}): Promise<GroundStationVisibilitySummary> {
  const vectors = await fetchHorizonsVectors({
    COMMAND: `'${getHorizonsMajorBodyId(params.targetId)}'`,
    CENTER: `'500@399'`,
    START_TIME: `'${params.startTime}'`,
    STOP_TIME: `'${params.stopTime}'`,
    STEP_SIZE: `'${params.stepSize ?? '1 h'}'`,
    EPHEM_TYPE: 'VECTORS',
    OUT_UNITS: 'KM-S',
    VEC_TABLE: '2',
    CSV_FORMAT: 'YES',
    CAL_FORMAT: 'JD',
    TIME_TYPE: 'UT',
  });

  const minElevationDeg = params.minElevationDeg ?? 10;
  const windows: VisibilityWindow[] = [];

  for (const station of DSN_STATIONS) {
    let currentStart: string | null = null;
    let currentMax = -90;
    let previousIso: string | null = null;

    for (const row of vectors) {
      const iso = new Date((row.jd - 2440587.5) * 86400000).toISOString();
      const elevation = elevationDeg(station, row);
      if (elevation >= minElevationDeg) {
        if (!currentStart) currentStart = iso;
        currentMax = Math.max(currentMax, elevation);
      } else if (currentStart && previousIso) {
        const durationMinutes = (Date.parse(previousIso) - Date.parse(currentStart)) / 60000;
        windows.push({
          stationId: station.id,
          stationName: station.name,
          startTime: currentStart,
          endTime: previousIso,
          durationMinutes: Math.max(0, durationMinutes),
          maxElevationDeg: currentMax,
        });
        currentStart = null;
        currentMax = -90;
      }
      previousIso = iso;
    }

    if (currentStart && previousIso) {
      const durationMinutes = (Date.parse(previousIso) - Date.parse(currentStart)) / 60000;
      windows.push({
        stationId: station.id,
        stationName: station.name,
        startTime: currentStart,
        endTime: previousIso,
        durationMinutes: Math.max(0, durationMinutes),
        maxElevationDeg: currentMax,
      });
    }
  }

  return {
    stations: DSN_STATIONS,
    windows: windows.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)),
    source: 'MODELED · DSN Visibility',
  };
}
