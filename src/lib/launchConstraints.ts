import { exponentialDensity } from './ascentDynamics';
import type { NoaaSurfaceWeather } from './noaa';

export interface LaunchConstraintAnalysis {
  densityAtMaxQKgM3: number;
  windConstraintScore: number;
  precipitationConstraintScore: number;
  upperAtmospherePenalty: number;
  goForLaunch: boolean;
  rationale: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function analyzeLaunchConstraints(params: {
  weather: NoaaSurfaceWeather | null;
  maxQAltitudeKm?: number;
  atmosphereScaleHeightKm?: number;
}): LaunchConstraintAnalysis {
  const weather = params.weather;
  const maxQAltitudeKm = params.maxQAltitudeKm ?? 11;
  const scaleHeightKm = params.atmosphereScaleHeightKm ?? 8.5;
  const densityAtMaxQKgM3 = exponentialDensity(maxQAltitudeKm * 1000, 1.225, scaleHeightKm * 1000);
  const windConstraintScore = clamp((weather?.wind_speed ?? 0) / 60, 0, 2);
  const precipitationConstraintScore = clamp((weather?.precipitation ?? 0) / 4, 0, 2);
  const upperAtmospherePenalty = clamp(densityAtMaxQKgM3 / 0.45, 0.2, 2);
  const goForLaunch = windConstraintScore < 1 && precipitationConstraintScore < 1.1;
  return {
    densityAtMaxQKgM3,
    windConstraintScore,
    precipitationConstraintScore,
    upperAtmospherePenalty,
    goForLaunch,
    rationale: goForLaunch
      ? 'Launch atmospheric and surface conditions remain inside the modeled commit envelope.'
      : 'Launch atmospheric or surface weather constraints exceed the modeled commit envelope.',
  };
}
