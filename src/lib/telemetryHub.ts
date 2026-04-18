export interface TelemetryFrame {
  timestamp: string;
  source: string;
  missionId?: string;
  stateVectorKm?: { x: number; y: number; z: number; vx?: number; vy?: number; vz?: number };
  commMarginDb?: number;
  radiationDoseRate?: number;
  propulsionDeltaVErrorPct?: number;
  powerMarginPct?: number;
  thermalMarginC?: number;
  subsystemFlags?: string[];
  crewStatus?: string;
}

const TELEMETRY_HISTORY: TelemetryFrame[] = [];
const MAX_TELEMETRY_HISTORY = 512;

export function ingestTelemetryFrame(frame: TelemetryFrame): TelemetryFrame {
  const normalized: TelemetryFrame = {
    ...frame,
    timestamp: frame.timestamp || new Date().toISOString(),
    source: frame.source || 'external-ingest',
    subsystemFlags: frame.subsystemFlags ?? [],
  };
  TELEMETRY_HISTORY.push(normalized);
  while (TELEMETRY_HISTORY.length > MAX_TELEMETRY_HISTORY) TELEMETRY_HISTORY.shift();
  return normalized;
}

export function getLatestTelemetryFrame(): TelemetryFrame | null {
  return TELEMETRY_HISTORY.length ? TELEMETRY_HISTORY[TELEMETRY_HISTORY.length - 1] : null;
}

export function getTelemetryHistory(limit = 50): TelemetryFrame[] {
  return TELEMETRY_HISTORY.slice(-Math.max(1, limit));
}
