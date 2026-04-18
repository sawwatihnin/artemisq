import { AU_KM, CELESTIAL_BODY_MAP, getApproximateHeliocentricPosition, getHeliocentricOrbitalRadiusKm } from './celestial';
import type { GroundStationVisibilitySummary } from './groundStations';
import { moonGeocentricPositionKm, normalize3 } from './lunarEphemeris';
import type { NoaaSpaceWeather, NoaaSurfaceWeather } from './noaa';
import type { RadiationEnvironment } from './radiationModel';

export interface OpsTrajectoryPoint {
  pos: [number, number, number];
  time_s?: number;
}

export interface MissionDoseAnalysis {
  cumulativeDoseMsv: number;
  peakDoseRateMsvHr: number;
  beltDoseMsv: number;
  deepSpaceDoseMsv: number;
  safeHavenRequired: boolean;
  safeHavenWindows: Array<{ startHour: number; endHour: number; reason: string }>;
}

export interface LightingAnalysis {
  eclipseFraction: number;
  longestEclipseHours: number;
  betaAngleDeg: number;
  eclipseIntervals: Array<{ startHour: number; endHour: number; body: 'EARTH' | 'MOON' }>;
}

export interface ConsumablesAnalysis {
  missionDurationHours: number;
  oxygenUsedKg: number;
  waterUsedKg: number;
  foodUsedKg: number;
  powerGeneratedKWh: number;
  powerConsumedKWh: number;
  batteryDrawKWh: number;
  commCoverageFraction: number;
  lifeSupportMarginHours: number;
  propellantReservePolicyPct: number;
}

export interface GoNoGoRuleResult {
  rule: string;
  status: 'GO' | 'WATCH' | 'NO_GO';
  value: number | string;
  threshold: string;
  rationale: string;
}

export interface GoNoGoAnalysis {
  overall: 'GO' | 'CONDITIONAL' | 'NO_GO';
  rationale: string;
  rules: GoNoGoRuleResult[];
}

export interface CislunarMissionOpsAnalysis {
  lane: 'CREWED_CISLUNAR_MISSION_OPS';
  dose: MissionDoseAnalysis;
  lighting: LightingAnalysis;
  consumables: ConsumablesAnalysis;
  goNoGo: GoNoGoAnalysis;
  provenance: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hoursBetween(a?: number, b?: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 6;
  return Math.max(0.05, (Math.abs((b ?? 0) - (a ?? 0))) / 3600);
}

function norm(v: [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sunDirectionFromEarth(date: Date): [number, number, number] {
  const earth = getApproximateHeliocentricPosition(CELESTIAL_BODY_MAP.earth, date);
  return normalize3([-earth[0], -earth[1], -earth[2]]);
}

function inShadowOfBody(
  spacecraftKm: [number, number, number],
  bodyCenterKm: [number, number, number],
  bodyRadiusKm: number,
  sunDirFromEarth: [number, number, number],
): boolean {
  const rel = sub(spacecraftKm, bodyCenterKm);
  const proj = dot(rel, sunDirFromEarth);
  if (proj > 0) return false;
  const perp = sub(rel, [sunDirFromEarth[0] * proj, sunDirFromEarth[1] * proj, sunDirFromEarth[2] * proj]);
  return norm(perp) <= bodyRadiusKm;
}

function computeLighting(
  trajectory: OpsTrajectoryPoint[],
  launchDate: string,
): LightingAnalysis {
  if (trajectory.length < 2) {
    return { eclipseFraction: 0, longestEclipseHours: 0, betaAngleDeg: 0, eclipseIntervals: [] };
  }

  const planeNormal = normalize3(cross(trajectory[0].pos, trajectory[Math.min(trajectory.length - 1, 1)].pos));
  const sunDir = sunDirectionFromEarth(new Date(`${launchDate}T12:00:00Z`));
  const betaAngleDeg = Math.asin(clamp(Math.abs(dot(planeNormal, sunDir)), 0, 1)) * (180 / Math.PI);
  const eclipseIntervals: LightingAnalysis['eclipseIntervals'] = [];
  let totalEclipseHours = 0;
  let currentStartHour: number | null = null;
  let currentBody: 'EARTH' | 'MOON' | null = null;
  let longestEclipseHours = 0;

  for (let i = 0; i < trajectory.length; i++) {
    const tHour = (trajectory[i].time_s ?? i * 21600) / 3600;
    const date = new Date(new Date(`${launchDate}T00:00:00Z`).getTime() + tHour * 3600000);
    const earthShadow = inShadowOfBody(trajectory[i].pos, [0, 0, 0], CELESTIAL_BODY_MAP.earth.radiusKm, sunDir);
    const moonPos = moonGeocentricPositionKm(date);
    const moonShadow = inShadowOfBody(trajectory[i].pos, moonPos, CELESTIAL_BODY_MAP.moon.radiusKm, sunDir);
    const eclipsedBy = earthShadow ? 'EARTH' : moonShadow ? 'MOON' : null;

    if (eclipsedBy && currentStartHour == null) {
      currentStartHour = tHour;
      currentBody = eclipsedBy;
    }
    if ((!eclipsedBy || eclipsedBy !== currentBody) && currentStartHour != null && currentBody) {
      const endHour = tHour;
      const duration = Math.max(0, endHour - currentStartHour);
      totalEclipseHours += duration;
      longestEclipseHours = Math.max(longestEclipseHours, duration);
      eclipseIntervals.push({ startHour: currentStartHour, endHour, body: currentBody });
      currentStartHour = eclipsedBy ? tHour : null;
      currentBody = eclipsedBy;
    }
  }

  if (currentStartHour != null && currentBody) {
    const endHour = (trajectory[trajectory.length - 1].time_s ?? (trajectory.length - 1) * 21600) / 3600;
    const duration = Math.max(0, endHour - currentStartHour);
    totalEclipseHours += duration;
    longestEclipseHours = Math.max(longestEclipseHours, duration);
    eclipseIntervals.push({ startHour: currentStartHour, endHour, body: currentBody });
  }

  const missionDurationHours = Math.max(0.1, (trajectory[trajectory.length - 1].time_s ?? (trajectory.length - 1) * 21600) / 3600);
  return {
    eclipseFraction: clamp(totalEclipseHours / missionDurationHours, 0, 1),
    longestEclipseHours,
    betaAngleDeg,
    eclipseIntervals,
  };
}

function computeDose(
  trajectory: OpsTrajectoryPoint[],
  launchDate: string,
  environment: RadiationEnvironment,
  spaceWeather: NoaaSpaceWeather,
  shieldingFactor = 0.72,
): MissionDoseAnalysis {
  let cumulativeDoseMsv = 0;
  let peakDoseRateMsvHr = 0;
  let beltDoseMsv = 0;
  let deepSpaceDoseMsv = 0;
  const safeHavenWindows: MissionDoseAnalysis['safeHavenWindows'] = [];
  const forcingIndex = clamp(0.6 * spaceWeather.radiationIndex + 0.4 * environment.aggregateIndex, 0.85, 4.25);
  const radiationMultiplier = clamp(1 - 0.65 * shieldingFactor, 0.32, 0.72);
  const baseSolarDoseRate = 0.02 + 0.012 * Math.max(forcingIndex - 1, 0);

  for (let i = 1; i < trajectory.length; i++) {
    const dtHours = hoursBetween(trajectory[i].time_s, trajectory[i - 1].time_s);
    const rKm = norm(trajectory[i].pos);
    const date = new Date(new Date(`${launchDate}T00:00:00Z`).getTime() + ((trajectory[i].time_s ?? i * 21600) * 1000));
    const heliocentricRadiusKm = getHeliocentricOrbitalRadiusKm(CELESTIAL_BODY_MAP.earth, date) ?? AU_KM;
    const sunDistanceScale = clamp((AU_KM / heliocentricRadiusKm) ** 2, 0.85, 1.15);
    let doseRate = baseSolarDoseRate * sunDistanceScale;
    let inBelt = false;

    for (const zone of environment.zones) {
      if (rKm >= zone.innerRadiusKm && rKm <= zone.outerRadiusKm) {
        const zoneRate = 0.038 * zone.severity;
        doseRate += zoneRate;
        beltDoseMsv += zoneRate * dtHours * radiationMultiplier;
        inBelt = true;
      }
    }

    if (!inBelt) {
      deepSpaceDoseMsv += baseSolarDoseRate * dtHours * radiationMultiplier;
    }

    const effectiveRate = doseRate * radiationMultiplier;
    cumulativeDoseMsv += effectiveRate * dtHours;
    peakDoseRateMsvHr = Math.max(peakDoseRateMsvHr, effectiveRate);

    if (effectiveRate > 0.14) {
      const startHour = (trajectory[i - 1].time_s ?? (i - 1) * 21600) / 3600;
      const endHour = (trajectory[i].time_s ?? i * 21600) / 3600;
      safeHavenWindows.push({
        startHour,
        endHour,
        reason: inBelt ? 'belt transit sheltering' : 'elevated solar particle environment',
      });
    }
  }

  return {
    cumulativeDoseMsv,
    peakDoseRateMsvHr,
    beltDoseMsv,
    deepSpaceDoseMsv,
    safeHavenRequired: peakDoseRateMsvHr > 0.14 || cumulativeDoseMsv > 50,
    safeHavenWindows,
  };
}

function computeConsumables(
  trajectory: OpsTrajectoryPoint[],
  lighting: LightingAnalysis,
  dsnVisibility: GroundStationVisibilitySummary | null,
  params: {
    crewCount?: number;
    powerGenerationKw?: number;
    hotelLoadKw?: number;
    batteryCapacityKWh?: number;
    propellantReserveFloorPct?: number;
  } = {},
): ConsumablesAnalysis {
  const missionDurationHours = Math.max(1, (trajectory[trajectory.length - 1]?.time_s ?? trajectory.length * 21600) / 3600);
  const crewCount = params.crewCount ?? 4;
  const oxygenUsedKg = crewCount * 0.84 * (missionDurationHours / 24);
  const waterUsedKg = crewCount * 3.2 * (missionDurationHours / 24);
  const foodUsedKg = crewCount * 0.62 * (missionDurationHours / 24);
  const powerGenerationKw = params.powerGenerationKw ?? 6.2;
  const hotelLoadKw = params.hotelLoadKw ?? 4.8;
  const illuminatedHours = missionDurationHours * (1 - lighting.eclipseFraction);
  const eclipseHours = missionDurationHours * lighting.eclipseFraction;
  const powerGeneratedKWh = illuminatedHours * powerGenerationKw;
  const powerConsumedKWh = missionDurationHours * hotelLoadKw;
  const batteryDrawKWh = Math.max(0, eclipseHours * hotelLoadKw - eclipseHours * powerGenerationKw * 0.08);
  const batteryCapacityKWh = params.batteryCapacityKWh ?? 180;
  const totalDsnMinutes = dsnVisibility?.windows?.reduce((sum, window) => sum + window.durationMinutes, 0) ?? 0;
  const commCoverageFraction = clamp(totalDsnMinutes / Math.max(1, missionDurationHours * 60), 0, 1);
  const lifeSupportMarginHours = Math.max(0, ((crewCount * 35 * 24) - missionDurationHours));
  const reserveWeatherFactor = 0.02 + 0.06 * lighting.eclipseFraction + (commCoverageFraction < 0.55 ? 0.03 : 0);
  const propellantReservePolicyPct = clamp((params.propellantReserveFloorPct ?? 12) + reserveWeatherFactor * 100, 8, 30);

  return {
    missionDurationHours,
    oxygenUsedKg,
    waterUsedKg,
    foodUsedKg,
    powerGeneratedKWh,
    powerConsumedKWh,
    batteryDrawKWh: clamp(batteryDrawKWh, 0, batteryCapacityKWh),
    commCoverageFraction,
    lifeSupportMarginHours,
    propellantReservePolicyPct,
  };
}

function computeGoNoGo(
  dose: MissionDoseAnalysis,
  lighting: LightingAnalysis,
  consumables: ConsumablesAnalysis,
  weather: NoaaSurfaceWeather | null,
  spaceWeather: NoaaSpaceWeather,
): GoNoGoAnalysis {
  const rules: GoNoGoRuleResult[] = [];

  const wind = weather?.wind_speed ?? 0;
  rules.push({
    rule: 'Launch Surface Wind',
    status: wind <= 45 ? 'GO' : wind <= 60 ? 'WATCH' : 'NO_GO',
    value: wind,
    threshold: '<= 45 km/h nominal, <= 60 km/h conditional',
    rationale: 'Surface wind constrains ascent loads, steering margin, and range safety.',
  });

  const weatherP = weather?.precipitation ?? 0;
  rules.push({
    rule: 'Launch Precipitation',
    status: weatherP <= 0.5 ? 'GO' : weatherP <= 2 ? 'WATCH' : 'NO_GO',
    value: weatherP,
    threshold: '<= 0.5 mm nominal, <= 2 mm conditional',
    rationale: 'Precipitation penalizes pad ops, visibility, and ascent environment quality.',
  });

  const rad = Math.max(spaceWeather.radiationIndex, dose.peakDoseRateMsvHr * 4);
  rules.push({
    rule: 'Space Weather / Crew Dose',
    status: rad <= 2 ? 'GO' : rad <= 3 ? 'WATCH' : 'NO_GO',
    value: Number(rad.toFixed(2)),
    threshold: '<= 2 nominal, <= 3 conditional',
    rationale: 'Live heliophysics forcing and along-trajectory dose jointly determine crew exposure posture.',
  });

  rules.push({
    rule: 'DSN / Relay Coverage',
    status: consumables.commCoverageFraction >= 0.6 ? 'GO' : consumables.commCoverageFraction >= 0.35 ? 'WATCH' : 'NO_GO',
    value: Number(consumables.commCoverageFraction.toFixed(2)),
    threshold: '>= 0.60 nominal, >= 0.35 conditional',
    rationale: 'Low comm coverage weakens command authority and contingency support.',
  });

  const batteryMargin = consumables.powerGeneratedKWh - consumables.powerConsumedKWh + consumables.batteryDrawKWh;
  rules.push({
    rule: 'Power / Eclipse Margin',
    status: lighting.longestEclipseHours <= 3.5 && batteryMargin >= -25 ? 'GO' : lighting.longestEclipseHours <= 6 ? 'WATCH' : 'NO_GO',
    value: Number(lighting.longestEclipseHours.toFixed(2)),
    threshold: '<= 3.5 h longest eclipse nominal, <= 6 h conditional',
    rationale: 'Eclipse duration and battery burden set the electrical survival margin.',
  });

  const noGo = rules.some((rule) => rule.status === 'NO_GO');
  const watch = rules.some((rule) => rule.status === 'WATCH');
  return {
    overall: noGo ? 'NO_GO' : watch ? 'CONDITIONAL' : 'GO',
    rationale: noGo
      ? 'One or more flight rules are outside commit criteria.'
      : watch
        ? 'Mission is conditionally acceptable but requires ops review before commit.'
        : 'Current launch and transit constraints satisfy the modeled commit criteria.',
    rules,
  };
}

export function analyzeCrewedCislunarMissionOps(params: {
  trajectory: OpsTrajectoryPoint[];
  launchDate: string;
  radiationEnvironment: RadiationEnvironment;
  spaceWeather: NoaaSpaceWeather;
  weather?: NoaaSurfaceWeather | null;
  dsnVisibility?: GroundStationVisibilitySummary | null;
  shieldingFactor?: number;
  crewCount?: number;
  powerGenerationKw?: number;
  hotelLoadKw?: number;
}): CislunarMissionOpsAnalysis {
  const lighting = computeLighting(params.trajectory, params.launchDate);
  const dose = computeDose(
    params.trajectory,
    params.launchDate,
    params.radiationEnvironment,
    params.spaceWeather,
    params.shieldingFactor,
  );
  const consumables = computeConsumables(params.trajectory, lighting, params.dsnVisibility ?? null, {
    crewCount: params.crewCount,
    powerGenerationKw: params.powerGenerationKw,
    hotelLoadKw: params.hotelLoadKw,
  });
  const goNoGo = computeGoNoGo(dose, lighting, consumables, params.weather ?? null, params.spaceWeather);

  return {
    lane: 'CREWED_CISLUNAR_MISSION_OPS',
    dose,
    lighting,
    consumables,
    goNoGo,
    provenance: [
      params.weather?.source ?? 'NO LIVE WEATHER',
      params.spaceWeather.source,
      params.radiationEnvironment.source,
      params.dsnVisibility?.source ?? 'NO LIVE DSN',
      'MODELED · Trajectory dose / eclipse / consumables / rules engine',
    ],
  };
}
