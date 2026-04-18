import { CELESTIAL_BODY_MAP, getDateAdjustedLocalGravity } from './celestial';

export interface SurfaceEnvironmentAnalysis {
  bodyId: string;
  localSolarHour: number;
  solarElevationDeg: number;
  localGravityMs2: number;
  estimatedSurfaceTempC: number;
  daylight: boolean;
  dustOrRegolithRisk: 'LOW' | 'MODERATE' | 'HIGH';
  source: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function analyzeSurfaceEnvironment(params: {
  bodyId: string;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm?: number;
  dateIso: string;
}): SurfaceEnvironmentAnalysis {
  const body = CELESTIAL_BODY_MAP[params.bodyId] ?? CELESTIAL_BODY_MAP.moon;
  const date = new Date(params.dateIso);
  const altitudeKm = params.altitudeKm ?? 0;
  const rotationHours = Math.abs(body.rotationPeriodHours || 24);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const localSolarHour = (((utcHours + params.longitudeDeg / 15) % rotationHours) + rotationHours) % rotationHours;
  const hourAngleDeg = ((localSolarHour / rotationHours) * 360) - 180;
  const latitudeRad = (params.latitudeDeg * Math.PI) / 180;
  const declinationDeg = body.id === 'mars' ? 25.19 * Math.sin((2 * Math.PI * (date.getUTCMonth() + 1)) / 12) : body.id === 'moon' ? 1.54 * Math.sin((2 * Math.PI * (date.getUTCMonth() + 1)) / 12) : 0;
  const declinationRad = (declinationDeg * Math.PI) / 180;
  const solarElevationDeg = Math.asin(
    Math.sin(latitudeRad) * Math.sin(declinationRad) +
    Math.cos(latitudeRad) * Math.cos(declinationRad) * Math.cos((hourAngleDeg * Math.PI) / 180),
  ) * (180 / Math.PI);
  const daylight = solarElevationDeg > 0;
  const localGravityMs2 = getDateAdjustedLocalGravity(body, params.latitudeDeg, params.longitudeDeg, altitudeKm, date);
  const estimatedSurfaceTempC =
    body.id === 'mars'
      ? clamp(-75 + 60 * Math.sin((solarElevationDeg * Math.PI) / 180), -140, 20)
      : body.id === 'moon'
        ? clamp(-180 + 290 * Math.max(0, Math.sin((solarElevationDeg * Math.PI) / 180)), -190, 120)
        : clamp(-20 + 35 * Math.sin((solarElevationDeg * Math.PI) / 180), -80, 50);
  const dustOrRegolithRisk =
    body.id === 'mars'
      ? estimatedSurfaceTempC > -40 ? 'HIGH' : 'MODERATE'
      : body.id === 'moon'
        ? Math.abs(params.latitudeDeg) < 75 && daylight ? 'MODERATE' : 'LOW'
        : 'LOW';

  return {
    bodyId: body.id,
    localSolarHour,
    solarElevationDeg,
    localGravityMs2,
    estimatedSurfaceTempC,
    daylight,
    dustOrRegolithRisk,
    source: 'FORMULA-DRIVEN · Surface environment support',
  };
}
