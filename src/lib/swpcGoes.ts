const SWPC_GOES_BASE = 'https://services.swpc.noaa.gov/json/goes/primary';

interface GoesFluxRow {
  time_tag: string;
  satellite: number;
  flux: number;
  energy: string;
}

export interface GoesRadiationSummary {
  protonFluxPfu: number;
  protonFlux10MeV: number;
  electronFluxGeo: number;
  radiationSeverityIndex: number;
  stormLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'SEVERE';
  source: string;
  observedAt: string | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function latestRows(rows: GoesFluxRow[]): GoesFluxRow[] {
  const latestTime = rows.reduce<string>((best, row) => row.time_tag > best ? row.time_tag : best, '');
  return rows.filter((row) => row.time_tag === latestTime);
}

async function fetchRows(endpoint: string): Promise<GoesFluxRow[]> {
  const response = await fetch(`${SWPC_GOES_BASE}/${endpoint}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ARTEMIS-Q/1.0 (local mission console)',
    },
  });
  if (!response.ok) throw new Error(`SWPC GOES HTTP ${response.status}`);
  return response.json() as Promise<GoesFluxRow[]>;
}

export async function fetchGoesRadiationSummary(): Promise<GoesRadiationSummary> {
  const [protons, electrons] = await Promise.all([
    fetchRows('integral-protons-6-hour.json'),
    fetchRows('integral-electrons-6-hour.json'),
  ]);

  const latestProtons = latestRows(protons);
  const latestElectrons = latestRows(electrons);
  const protonFlux1 = latestProtons.find((row) => row.energy === '>=1 MeV')?.flux ?? 0;
  const protonFlux10 = latestProtons.find((row) => row.energy === '>=10 MeV')?.flux ?? 0;
  const electronFlux = latestElectrons.find((row) => row.energy === '>=2 MeV')?.flux ?? 0;
  const observedAt = latestProtons[0]?.time_tag ?? latestElectrons[0]?.time_tag ?? null;

  const radiationSeverityIndex = clamp(
    1
      + Math.log10(1 + protonFlux1) * 0.22
      + Math.log10(1 + protonFlux10 * 10) * 0.34
      + Math.log10(1 + electronFlux) * 0.18,
    0.9,
    4.5,
  );

  const stormLevel =
    protonFlux10 >= 1000 ? 'SEVERE' :
    protonFlux10 >= 100 ? 'HIGH' :
    protonFlux10 >= 10 ? 'MEDIUM' :
    'LOW';

  return {
    protonFluxPfu: protonFlux1,
    protonFlux10MeV: protonFlux10,
    electronFluxGeo: electronFlux,
    radiationSeverityIndex,
    stormLevel,
    source: 'LIVE · NOAA SWPC GOES',
    observedAt,
  };
}
