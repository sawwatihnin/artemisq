const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

export interface OpenMeteoWeather {
  temp: number | null;
  wind_speed: number;
  precipitation: number;
  pressure: number;
  humidity: number | null;
  source: string;
  forecastTime: string | null;
}

interface OpenMeteoResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    wind_speed_10m?: number;
    precipitation?: number;
    surface_pressure?: number;
    relative_humidity_2m?: number;
  };
}

export async function fetchOpenMeteoWeather(lat: number, lon: number): Promise<OpenMeteoWeather> {
  const url = new URL(OPEN_METEO_BASE);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m,wind_speed_10m,precipitation,surface_pressure,relative_humidity_2m');
  url.searchParams.set('temperature_unit', 'celsius');
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('precipitation_unit', 'mm');
  url.searchParams.set('timeformat', 'iso8601');

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ARTEMIS-Q/1.0 (local mission console)',
    },
  });
  if (!response.ok) {
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }
  const payload = await response.json() as OpenMeteoResponse;
  const current = payload.current ?? {};
  return {
    temp: current.temperature_2m ?? null,
    wind_speed: current.wind_speed_10m ?? 0,
    precipitation: current.precipitation ?? 0,
    pressure: current.surface_pressure ?? 101.325,
    humidity: current.relative_humidity_2m ?? null,
    forecastTime: current.time ?? null,
    source: 'LIVE · Open-Meteo',
  };
}
