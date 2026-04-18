const NOAA_NWS_BASE = 'https://api.weather.gov';
const NOAA_SWPC_BASE = 'https://services.swpc.noaa.gov/json';
const NOAA_USER_AGENT = process.env.NOAA_USER_AGENT ?? 'ARTEMIS-Q/1.0 (local mission console)';

interface NoaaPointResponse {
  properties?: {
    forecastHourly?: string;
    observationStations?: string;
  };
}

interface NoaaForecastPeriod {
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  probabilityOfPrecipitation?: { value?: number | null };
  relativeHumidity?: { value?: number | null };
  shortForecast?: string;
}

interface NoaaForecastResponse {
  properties?: {
    periods?: NoaaForecastPeriod[];
  };
}

interface NoaaStationCollection {
  observationStations?: string[];
  features?: Array<{ id?: string }>;
}

interface NoaaObservationResponse {
  properties?: {
    stationId?: string;
    stationName?: string;
    timestamp?: string;
    textDescription?: string;
    temperature?: { value?: number | null };
    windSpeed?: { value?: number | null };
    barometricPressure?: { value?: number | null };
    precipitationLastHour?: { value?: number | null };
    relativeHumidity?: { value?: number | null };
  };
}

interface SwpcSolarProbabilityRow {
  date: string;
  m_class_1_day?: number;
  x_class_1_day?: number;
  '10mev_protons_1_day'?: number;
  polar_cap_absorption?: string;
}

interface SwpcKpRow {
  time_tag: string;
  kp_index?: number;
  estimated_kp?: number;
}

export interface NoaaSurfaceWeather {
  temp: number | null;
  wind_speed: number;
  precipitation: number;
  pressure: number;
  humidity: number | null;
  stationId: string | null;
  stationName: string | null;
  shortForecast: string | null;
  observedAt: string | null;
  source: string;
}

export interface NoaaSpaceWeather {
  radiationIndex: number;
  eventCount: number;
  kpIndex: number;
  mClassProbability: number;
  xClassProbability: number;
  protonProbability: number;
  polarCapAbsorption: string;
  forecastDate: string | null;
  source: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function fetchJson<T>(url: string, accept = 'application/json'): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      'User-Agent': NOAA_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`NOAA HTTP ${response.status} for ${url}`);
  }
  return response.json() as Promise<T>;
}

function fahrenheitToCelsius(value: number): number {
  return (value - 32) * (5 / 9);
}

function parseWindSpeedToKmh(value: string | undefined): number {
  if (!value) return 0;
  const numbers = value.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (!numbers.length) return 0;
  const mean = numbers.reduce((sum, item) => sum + item, 0) / numbers.length;
  if (value.includes('kt')) return mean * 1.852;
  if (value.includes('mph')) return mean * 1.60934;
  return mean;
}

function latestByDate<T>(rows: T[], selector: (row: T) => string | undefined): T | null {
  return rows.reduce<T | null>((best, row) => {
    const value = selector(row);
    if (!value) return best;
    if (!best) return row;
    const bestValue = selector(best);
    if (!bestValue) return row;
    return Date.parse(value) > Date.parse(bestValue) ? row : best;
  }, null);
}

export async function fetchNoaaSurfaceWeather(lat: number, lon: number): Promise<NoaaSurfaceWeather> {
  const points = await fetchJson<NoaaPointResponse>(`${NOAA_NWS_BASE}/points/${lat},${lon}`, 'application/geo+json');
  const forecastUrl = points.properties?.forecastHourly;
  const stationsUrl = points.properties?.observationStations;

  if (!forecastUrl || !stationsUrl) {
    throw new Error('NOAA point lookup did not return forecast/station endpoints');
  }

  const [forecast, stations] = await Promise.all([
    fetchJson<NoaaForecastResponse>(forecastUrl, 'application/geo+json'),
    fetchJson<NoaaStationCollection>(stationsUrl, 'application/geo+json'),
  ]);

  const firstStationUrl = stations.observationStations?.[0] ?? stations.features?.[0]?.id;
  const observation = firstStationUrl
    ? await fetchJson<NoaaObservationResponse>(`${firstStationUrl}/observations/latest`, 'application/geo+json')
    : null;

  const period = forecast.properties?.periods?.[0];
  const observedTempC = observation?.properties?.temperature?.value;
  const forecastTempC = typeof period?.temperature === 'number'
    ? (period.temperatureUnit === 'F' ? fahrenheitToCelsius(period.temperature) : period.temperature)
    : null;
  const windSpeedKmh = observation?.properties?.windSpeed?.value ?? parseWindSpeedToKmh(period?.windSpeed);
  const pressureKpa = (observation?.properties?.barometricPressure?.value ?? 101325) / 1000;
  const precipitationMm = observation?.properties?.precipitationLastHour?.value ?? 0;
  const humidity = observation?.properties?.relativeHumidity?.value ?? period?.relativeHumidity?.value ?? null;

  return {
    temp: observedTempC ?? forecastTempC,
    wind_speed: windSpeedKmh,
    precipitation: precipitationMm,
    pressure: pressureKpa,
    humidity,
    stationId: observation?.properties?.stationId ?? null,
    stationName: observation?.properties?.stationName ?? null,
    shortForecast: observation?.properties?.textDescription ?? period?.shortForecast ?? null,
    observedAt: observation?.properties?.timestamp ?? null,
    source: 'LIVE · NOAA NWS',
  };
}

export async function fetchNoaaSpaceWeather(): Promise<NoaaSpaceWeather> {
  const [probabilities, kpRows] = await Promise.all([
    fetchJson<SwpcSolarProbabilityRow[]>(`${NOAA_SWPC_BASE}/solar_probabilities.json`),
    fetchJson<SwpcKpRow[]>(`${NOAA_SWPC_BASE}/planetary_k_index_1m.json`),
  ]);

  const latestProbabilities = latestByDate(probabilities, (row) => row.date);
  const latestKp = latestByDate(kpRows, (row) => row.time_tag);

  const mClassProbability = (latestProbabilities?.m_class_1_day ?? 0) / 100;
  const xClassProbability = (latestProbabilities?.x_class_1_day ?? 0) / 100;
  const protonProbability = (latestProbabilities?.['10mev_protons_1_day'] ?? 0) / 100;
  const kpIndex = latestKp?.estimated_kp ?? latestKp?.kp_index ?? 0;

  const pca = (latestProbabilities?.polar_cap_absorption ?? 'green').toLowerCase();
  const pcaFactor = pca === 'red' ? 0.3 : pca === 'yellow' ? 0.15 : 0;
  const radiationIndex = clamp(
    1
      + 0.55 * mClassProbability
      + 1.15 * xClassProbability
      + 0.85 * protonProbability
      + 0.35 * (kpIndex / 9)
      + pcaFactor,
    0.9,
    3.5,
  );

  const eventCount =
    (mClassProbability >= 0.2 ? 1 : 0)
    + (xClassProbability >= 0.05 ? 1 : 0)
    + (protonProbability >= 0.1 ? 1 : 0)
    + (kpIndex >= 5 ? 1 : 0);

  return {
    radiationIndex,
    eventCount,
    kpIndex,
    mClassProbability,
    xClassProbability,
    protonProbability,
    polarCapAbsorption: pca,
    forecastDate: latestProbabilities?.date ?? null,
    source: 'LIVE · NOAA SWPC',
  };
}
