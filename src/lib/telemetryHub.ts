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

const TELEMETRY_HISTORY = new Map<string, TelemetryFrame[]>();
const DEFAULT_MISSION_ID = 'default';
const MAX_TELEMETRY_HISTORY_PER_MISSION = 256;
const MAX_SUBSYSTEM_FLAGS = 16;

function normalizeFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeMissionId(value: unknown): string {
  const missionId = typeof value === 'string' ? value.trim() : '';
  return missionId.slice(0, 64) || DEFAULT_MISSION_ID;
}

function normalizeString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, maxLength);
}

function normalizeStateVector(value: unknown): TelemetryFrame['stateVectorKm'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const x = normalizeFiniteNumber(candidate.x);
  const y = normalizeFiniteNumber(candidate.y);
  const z = normalizeFiniteNumber(candidate.z);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return {
    x,
    y,
    z,
    vx: normalizeFiniteNumber(candidate.vx),
    vy: normalizeFiniteNumber(candidate.vy),
    vz: normalizeFiniteNumber(candidate.vz),
  };
}

export function ingestTelemetryFrame(frame: TelemetryFrame): TelemetryFrame {
  const missionId = normalizeMissionId(frame.missionId);
  const normalized: TelemetryFrame = {
    missionId,
    timestamp: normalizeString(frame.timestamp, new Date().toISOString(), 64),
    source: normalizeString(frame.source, 'external-ingest', 64),
    stateVectorKm: normalizeStateVector(frame.stateVectorKm),
    commMarginDb: normalizeFiniteNumber(frame.commMarginDb),
    radiationDoseRate: normalizeFiniteNumber(frame.radiationDoseRate),
    propulsionDeltaVErrorPct: normalizeFiniteNumber(frame.propulsionDeltaVErrorPct),
    powerMarginPct: normalizeFiniteNumber(frame.powerMarginPct),
    thermalMarginC: normalizeFiniteNumber(frame.thermalMarginC),
    subsystemFlags: Array.isArray(frame.subsystemFlags)
      ? frame.subsystemFlags
          .filter((flag): flag is string => typeof flag === 'string')
          .map((flag) => flag.trim())
          .filter(Boolean)
          .slice(0, MAX_SUBSYSTEM_FLAGS)
      : [],
    crewStatus: typeof frame.crewStatus === 'string' ? frame.crewStatus.trim().slice(0, 64) : undefined,
  };
  const history = TELEMETRY_HISTORY.get(missionId) ?? [];
  history.push(normalized);
  while (history.length > MAX_TELEMETRY_HISTORY_PER_MISSION) history.shift();
  TELEMETRY_HISTORY.set(missionId, history);
  return normalized;
}

export function getLatestTelemetryFrame(missionId = DEFAULT_MISSION_ID): TelemetryFrame | null {
  const history = TELEMETRY_HISTORY.get(normalizeMissionId(missionId));
  return history?.length ? history[history.length - 1] : null;
}

export function getTelemetryHistory(limit = 50, missionId = DEFAULT_MISSION_ID): TelemetryFrame[] {
  const history = TELEMETRY_HISTORY.get(normalizeMissionId(missionId)) ?? [];
  return history.slice(-Math.max(1, Math.min(200, limit)));
}
