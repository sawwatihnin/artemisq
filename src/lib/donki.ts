const DONKI_BASE_URL = process.env.DONKI_BASE_URL ?? 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get';
const DONKI_API_KEY = process.env.NASA_API_KEY ?? '';

interface DonkiLinkedEvent {
  activityID?: string;
}

interface DonkiCmeAnalysis {
  speed?: number | null;
  halfAngle?: number | null;
}

interface DonkiCmeEvent {
  activityID?: string;
  startTime?: string;
  sourceLocation?: string | null;
  note?: string | null;
  cmeAnalyses?: DonkiCmeAnalysis[];
  linkedEvents?: DonkiLinkedEvent[];
}

interface DonkiFlareEvent {
  flrID?: string;
  beginTime?: string;
  peakTime?: string;
  classType?: string | null;
  sourceLocation?: string | null;
  linkedEvents?: DonkiLinkedEvent[];
}

interface DonkiSepEvent {
  sepID?: string;
  eventTime?: string;
  linkedEvents?: DonkiLinkedEvent[];
}

interface DonkiGstKp {
  observedTime?: string;
  kpIndex?: number | null;
}

interface DonkiGstEvent {
  gstID?: string;
  startTime?: string;
  allKpIndex?: DonkiGstKp[];
  linkedEvents?: DonkiLinkedEvent[];
}

export interface DonkiSpaceWeatherSummary {
  eventCount: number;
  cmeCount: number;
  flareCount: number;
  sepCount: number;
  gstCount: number;
  severeFlareCount: number;
  maxKp: number;
  maxCmeSpeed: number;
  radiationBoost: number;
  source: string;
  windowStart: string;
  windowEnd: string;
  cmes: DonkiCmeEvent[];
  flares: DonkiFlareEvent[];
  seps: DonkiSepEvent[];
  gsts: DonkiGstEvent[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDonkiUrl(endpoint: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(`${DONKI_BASE_URL}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
  });
  if (DONKI_API_KEY) {
    url.searchParams.set('api_key', DONKI_API_KEY);
  }
  return url.toString();
}

async function fetchDonkiJson<T>(endpoint: string, params: Record<string, string | number | undefined>): Promise<T> {
  const response = await fetch(buildDonkiUrl(endpoint, params), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ARTEMIS-Q/1.0 (local mission console)',
    },
  });
  if (!response.ok) {
    throw new Error(`DONKI HTTP ${response.status} for ${endpoint}`);
  }
  return response.json() as Promise<T>;
}

function countSevereFlares(flares: DonkiFlareEvent[]): number {
  return flares.filter((flare) => {
    const cls = (flare.classType ?? '').toUpperCase();
    return cls.startsWith('M') || cls.startsWith('X');
  }).length;
}

function maxCmeSpeed(cmes: DonkiCmeEvent[]): number {
  return cmes.reduce((max, cme) => {
    const speed = cme.cmeAnalyses?.reduce((best, analysis) => Math.max(best, analysis.speed ?? 0), 0) ?? 0;
    return Math.max(max, speed);
  }, 0);
}

function maxGeomagneticKp(gsts: DonkiGstEvent[]): number {
  return gsts.reduce((max, gst) => {
    const kp = gst.allKpIndex?.reduce((best, item) => Math.max(best, item.kpIndex ?? 0), 0) ?? 0;
    return Math.max(max, kp);
  }, 0);
}

export async function fetchDonkiSpaceWeatherSummary(days = 7): Promise<DonkiSpaceWeatherSummary> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const startDate = formatUtcDate(start);
  const endDate = formatUtcDate(end);

  const [cmes, flares, seps, gsts] = await Promise.all([
    fetchDonkiJson<DonkiCmeEvent[]>('CME', { startDate, endDate }),
    fetchDonkiJson<DonkiFlareEvent[]>('FLR', { startDate, endDate }),
    fetchDonkiJson<DonkiSepEvent[]>('SEP', { startDate, endDate }),
    fetchDonkiJson<DonkiGstEvent[]>('GST', { startDate, endDate }),
  ]);

  const severeFlareCount = countSevereFlares(flares);
  const maxKp = maxGeomagneticKp(gsts);
  const peakCmeSpeed = maxCmeSpeed(cmes);
  const eventCount = cmes.length + flares.length + seps.length + gsts.length;

  const radiationBoost = clamp(
    1
      + Math.min(cmes.length, 8) * 0.06
      + severeFlareCount * 0.08
      + seps.length * 0.18
      + Math.max(0, maxKp - 4) * 0.05
      + Math.max(0, peakCmeSpeed - 800) / 8000,
    1,
    3,
  );

  return {
    eventCount,
    cmeCount: cmes.length,
    flareCount: flares.length,
    sepCount: seps.length,
    gstCount: gsts.length,
    severeFlareCount,
    maxKp,
    maxCmeSpeed: peakCmeSpeed,
    radiationBoost,
    source: 'LIVE · NASA CCMC DONKI',
    windowStart: startDate,
    windowEnd: endDate,
    cmes,
    flares,
    seps,
    gsts,
  };
}
