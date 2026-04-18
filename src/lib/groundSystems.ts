import type { EonetEventSummary } from './eonet';

export interface LaunchSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  country: string;
  pads: Array<{ id: string; name: string; supportedVehicles: string[] }>;
}

export interface GroundConstraintAssessment {
  launchSite: LaunchSite;
  padStatus: Array<{ padId: string; available: boolean; rationale: string }>;
  keepOutZones: Array<{ label: string; radiusKm: number; azimuthCenterDeg: number; azimuthHalfWidthDeg: number }>;
  recoveryCorridors: Array<{ label: string; headingDeg: number; lengthKm: number; widthKm: number }>;
  airspaceMaritimeExclusions: Array<{ label: string; footprintKm2: number; active: boolean }>;
  rangeGo: boolean;
  rationale: string;
}

export const LAUNCH_SITES: LaunchSite[] = [
  {
    id: 'ksc',
    name: 'Kennedy Space Center / Cape Canaveral',
    lat: 28.5729,
    lon: -80.649,
    country: 'USA',
    pads: [
      { id: 'lc39a', name: 'LC-39A', supportedVehicles: ['Falcon 9', 'Falcon Heavy', 'Starship'] },
      { id: 'lc39b', name: 'LC-39B', supportedVehicles: ['SLS', 'Artemis'] },
      { id: 'slc40', name: 'SLC-40', supportedVehicles: ['Falcon 9'] },
    ],
  },
  {
    id: 'vafb',
    name: 'Vandenberg SFB',
    lat: 34.742,
    lon: -120.5724,
    country: 'USA',
    pads: [
      { id: 'slc4e', name: 'SLC-4E', supportedVehicles: ['Falcon 9'] },
      { id: 'slc6', name: 'SLC-6', supportedVehicles: ['Heavy Lift'] },
    ],
  },
  {
    id: 'kourou',
    name: 'Guiana Space Centre',
    lat: 5.239,
    lon: -52.768,
    country: 'France',
    pads: [
      { id: 'ela4', name: 'ELA-4', supportedVehicles: ['Ariane 6'] },
      { id: 'zl3', name: 'ZL-3', supportedVehicles: ['Vega'] },
    ],
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function findLaunchSite(idOrName: string): LaunchSite | null {
  const normalized = idOrName.trim().toLowerCase();
  return LAUNCH_SITES.find((site) => site.id === normalized || site.name.toLowerCase().includes(normalized)) ?? null;
}

export function assessGroundConstraints(params: {
  launchSiteId: string;
  vehicleName: string;
  launchAzimuthDeg: number;
  weatherWindKmh: number;
  precipitationMm: number;
  missionType?: string;
  eonet?: EonetEventSummary | null;
  launchDate?: string;
}): GroundConstraintAssessment {
  const site = findLaunchSite(params.launchSiteId) ?? LAUNCH_SITES[0];
  const launchDate = params.launchDate ? new Date(params.launchDate) : new Date();
  const weekday = launchDate.getUTCDay();
  const hour = launchDate.getUTCHours();
  const weekendPenalty = weekday === 0 || weekday === 6;
  const offShiftPenalty = hour < 10 || hour > 22;

  const padStatus = site.pads.map((pad, index) => {
    const vehicleCompatible = pad.supportedVehicles.some((item) => params.vehicleName.toLowerCase().includes(item.toLowerCase()) || item.toLowerCase().includes(params.vehicleName.toLowerCase()));
    const maintenanceWindow = (weekday === 2 && index === 0) || (weekday === 4 && index === 1);
    const available = vehicleCompatible && !maintenanceWindow;
    return {
      padId: pad.id,
      available,
      rationale: !vehicleCompatible
        ? 'Vehicle/pad mismatch'
        : maintenanceWindow
          ? 'Modeled pad maintenance window'
          : 'Pad compatible and nominally available',
    };
  });

  const keepOutZones = [
    { label: 'Public Safety Arc', radiusKm: 35, azimuthCenterDeg: params.launchAzimuthDeg, azimuthHalfWidthDeg: 18 },
    { label: 'Stage Drop Hazard', radiusKm: 220, azimuthCenterDeg: params.launchAzimuthDeg + 8, azimuthHalfWidthDeg: 24 },
    { label: 'Booster RTLS Corridor', radiusKm: 120, azimuthCenterDeg: params.launchAzimuthDeg - 35, azimuthHalfWidthDeg: 15 },
  ];

  const recoveryCorridors = [
    { label: 'Primary Recovery', headingDeg: params.launchAzimuthDeg + 90, lengthKm: 650, widthKm: 70 },
    { label: 'Secondary Recovery', headingDeg: params.launchAzimuthDeg + 110, lengthKm: 900, widthKm: 90 },
  ];

  const hazardAmplifier = params.eonet?.total ? clamp(1 + params.eonet.total / 20, 1, 2.2) : 1;
  const airspaceMaritimeExclusions = recoveryCorridors.map((corridor, index) => ({
    label: `${corridor.label} exclusion`,
    footprintKm2: corridor.lengthKm * corridor.widthKm * hazardAmplifier * (index === 0 ? 1 : 1.15),
    active: true,
  }));

  const weatherNoGo = params.weatherWindKmh > 55 || params.precipitationMm > 3;
  const rangeGo = padStatus.some((pad) => pad.available) && !weatherNoGo;
  const rationale = rangeGo
    ? `Range is go; at least one compatible pad is open and environmental exclusions remain manageable${weekendPenalty || offShiftPenalty ? ' with reduced ops margin' : ''}.`
    : 'Range is no-go due to pad incompatibility/maintenance or launch weather outside commit criteria.';

  return {
    launchSite: site,
    padStatus,
    keepOutZones,
    recoveryCorridors,
    airspaceMaritimeExclusions,
    rangeGo,
    rationale,
  };
}
