import { fetchDonkiSpaceWeatherSummary } from './donki';
import { buildNearEarthRadiationEnvironment } from './radiationModel';
import { fetchGoesRadiationSummary } from './swpcGoes';

export interface RadiationSnapshot {
  fetchedAt: string;
  goes: Awaited<ReturnType<typeof fetchGoesRadiationSummary>>;
  donki: Awaited<ReturnType<typeof fetchDonkiSpaceWeatherSummary>>;
  environment: ReturnType<typeof buildNearEarthRadiationEnvironment>;
  source: string;
  days: number;
}

const radiationHistory: RadiationSnapshot[] = [];
const MAX_RADIATION_HISTORY = 48;
const RADIATION_CACHE_TTL_MS = 30 * 60 * 1000;

function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 7;
  return Math.max(1, Math.min(30, Math.round(days)));
}

export async function ingestLiveRadiationSnapshot(days = 7): Promise<RadiationSnapshot> {
  const normalizedDays = clampDays(days);
  const [goes, donki] = await Promise.all([
    fetchGoesRadiationSummary(),
    fetchDonkiSpaceWeatherSummary(normalizedDays),
  ]);
  const environment = buildNearEarthRadiationEnvironment(goes, donki.radiationBoost);
  const snapshot: RadiationSnapshot = {
    fetchedAt: new Date().toISOString(),
    goes,
    donki,
    environment,
    source: `${goes.source} + ${donki.source}`,
    days: normalizedDays,
  };
  radiationHistory.unshift(snapshot);
  if (radiationHistory.length > MAX_RADIATION_HISTORY) radiationHistory.length = MAX_RADIATION_HISTORY;
  return snapshot;
}

export function getLatestRadiationSnapshot(): RadiationSnapshot | null {
  return radiationHistory[0] ?? null;
}

export function getRadiationSnapshotHistory(limit = 12): RadiationSnapshot[] {
  return radiationHistory.slice(0, Math.max(1, limit));
}

export function shouldRefreshRadiationSnapshot(snapshot: RadiationSnapshot | null, days = 7): boolean {
  if (!snapshot) return true;
  if (snapshot.days !== clampDays(days)) return true;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return true;
  return Date.now() - fetchedAt > RADIATION_CACHE_TTL_MS;
}
