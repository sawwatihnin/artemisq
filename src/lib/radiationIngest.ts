import { fetchDonkiSpaceWeatherSummary } from './donki';
import { buildNearEarthRadiationEnvironment } from './radiationModel';
import { fetchGoesRadiationSummary } from './swpcGoes';

export interface RadiationSnapshot {
  fetchedAt: string;
  goes: Awaited<ReturnType<typeof fetchGoesRadiationSummary>>;
  donki: Awaited<ReturnType<typeof fetchDonkiSpaceWeatherSummary>>;
  environment: ReturnType<typeof buildNearEarthRadiationEnvironment>;
  source: string;
}

const radiationHistory: RadiationSnapshot[] = [];

export async function ingestLiveRadiationSnapshot(days = 7): Promise<RadiationSnapshot> {
  const [goes, donki] = await Promise.all([
    fetchGoesRadiationSummary(),
    fetchDonkiSpaceWeatherSummary(days),
  ]);
  const environment = buildNearEarthRadiationEnvironment(goes, donki.radiationBoost);
  const snapshot: RadiationSnapshot = {
    fetchedAt: new Date().toISOString(),
    goes,
    donki,
    environment,
    source: `${goes.source} + ${donki.source}`,
  };
  radiationHistory.unshift(snapshot);
  if (radiationHistory.length > 48) radiationHistory.length = 48;
  return snapshot;
}

export function getLatestRadiationSnapshot(): RadiationSnapshot | null {
  return radiationHistory[0] ?? null;
}

export function getRadiationSnapshotHistory(limit = 12): RadiationSnapshot[] {
  return radiationHistory.slice(0, Math.max(1, limit));
}
