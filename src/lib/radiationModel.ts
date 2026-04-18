import type { GoesRadiationSummary } from './swpcGoes';

export interface RadiationZone {
  label: string;
  innerRadiusKm: number;
  outerRadiusKm: number;
  severity: number;
  color: string;
}

export interface RadiationEnvironment {
  zones: RadiationZone[];
  aggregateIndex: number;
  notes: string[];
  source: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildNearEarthRadiationEnvironment(goes: GoesRadiationSummary, donkiBoost = 1): RadiationEnvironment {
  const severity = clamp(goes.radiationSeverityIndex * donkiBoost, 0.9, 5.2);
  const protonScale = clamp(1 + Math.log10(1 + goes.protonFlux10MeV), 1, 4);
  const electronScale = clamp(1 + Math.log10(1 + goes.electronFluxGeo), 1, 4);

  return {
    zones: [
      {
        label: 'Inner Belt',
        innerRadiusKm: 1200,
        outerRadiusKm: 6000 + 400 * protonScale,
        severity: clamp(1.2 * severity, 1, 6),
        color: '#f59e0b',
      },
      {
        label: 'Slot Region',
        innerRadiusKm: 6000 + 400 * protonScale,
        outerRadiusKm: 13000 + 900 * electronScale,
        severity: clamp(0.55 * severity, 0.4, 3),
        color: '#facc15',
      },
      {
        label: 'Outer Belt',
        innerRadiusKm: 13000 + 900 * electronScale,
        outerRadiusKm: 42000 + 2400 * electronScale,
        severity: clamp(1.6 * severity, 1, 7),
        color: '#ef4444',
      },
    ],
    aggregateIndex: severity,
    notes: [
      'Near-Earth belt overlay is a physics-based shell approximation scaled by live GOES proton/electron flux.',
      `Current GOES storm level is ${goes.stormLevel}.`,
    ],
    source: `${goes.source} + modeled trapped-radiation shells`,
  };
}
