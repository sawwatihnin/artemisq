import type { ECIState, TrajectoryPoint } from './orbital';

export interface CcsdsMetadata {
  objectName: string;
  objectId: string;
  centerName?: string;
  refFrame?: string;
  timeSystem?: string;
}

export interface MissionBaselineComparison {
  addedKeys: string[];
  removedKeys: string[];
  changedValues: Array<{ path: string; before: string; after: string }>;
  versionHashBefore: string;
  versionHashAfter: string;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return `cfg-${(hash >>> 0).toString(16)}`;
}

export function versionMissionConfig(config: unknown): { versionHash: string; stablePayload: string } {
  const stablePayload = stableStringify(config);
  return {
    versionHash: hashString(stablePayload),
    stablePayload,
  };
}

export function exportOem(points: TrajectoryPoint[], metadata: CcsdsMetadata): string {
  const lines = [
    'CCSDS_OEM_VERS = 2.0',
    `CREATION_DATE = ${new Date().toISOString()}`,
    `ORIGINATOR = ARTEMIS-Q`,
    'META_START',
    `OBJECT_NAME = ${metadata.objectName}`,
    `OBJECT_ID = ${metadata.objectId}`,
    `CENTER_NAME = ${metadata.centerName ?? 'EARTH'}`,
    `REF_FRAME = ${metadata.refFrame ?? 'EME2000'}`,
    `TIME_SYSTEM = ${metadata.timeSystem ?? 'UTC'}`,
    'META_STOP',
  ];
  for (const point of points) {
    const epoch = new Date((point.time_s ?? 0) * 1000).toISOString();
    const vel = point.vel ?? [0, 0, 0];
    lines.push(`${epoch} ${point.pos[0].toFixed(6)} ${point.pos[1].toFixed(6)} ${point.pos[2].toFixed(6)} ${vel[0].toFixed(9)} ${vel[1].toFixed(9)} ${vel[2].toFixed(9)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function exportOpm(state: ECIState, epochIso: string, metadata: CcsdsMetadata): string {
  return [
    'CCSDS_OPM_VERS = 2.0',
    `CREATION_DATE = ${new Date().toISOString()}`,
    `ORIGINATOR = ARTEMIS-Q`,
    `OBJECT_NAME = ${metadata.objectName}`,
    `OBJECT_ID = ${metadata.objectId}`,
    `CENTER_NAME = ${metadata.centerName ?? 'EARTH'}`,
    `REF_FRAME = ${metadata.refFrame ?? 'EME2000'}`,
    `TIME_SYSTEM = ${metadata.timeSystem ?? 'UTC'}`,
    `EPOCH = ${epochIso}`,
    `X = ${state.r[0].toFixed(6)}`,
    `Y = ${state.r[1].toFixed(6)}`,
    `Z = ${state.r[2].toFixed(6)}`,
    `X_DOT = ${state.v[0].toFixed(9)}`,
    `Y_DOT = ${state.v[1].toFixed(9)}`,
    `Z_DOT = ${state.v[2].toFixed(9)}`,
    '',
  ].join('\n');
}

export function importOemLike(text: string): { metadata: Record<string, string>; points: TrajectoryPoint[] } {
  const metadata: Record<string, string> = {};
  const points: TrajectoryPoint[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.includes('=') && !/^\d{4}-\d{2}-\d{2}T/.test(line)) {
      const [k, ...rest] = line.split('=');
      metadata[k.trim()] = rest.join('=').trim();
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
      const [epoch, x, y, z, vx, vy, vz] = line.split(/\s+/);
      points.push({
        time_s: Date.parse(epoch) / 1000,
        pos: [Number(x), Number(y), Number(z)],
        vel: [Number(vx ?? 0), Number(vy ?? 0), Number(vz ?? 0)],
      });
    }
  }
  return { metadata, points };
}

function walkDiff(before: unknown, after: unknown, path: string, out: MissionBaselineComparison['changedValues'], added: string[], removed: string[]) {
  if (before === undefined && after !== undefined) {
    added.push(path);
    return;
  }
  if (before !== undefined && after === undefined) {
    removed.push(path);
    return;
  }
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) {
    if (stableStringify(before) !== stableStringify(after)) {
      out.push({ path, before: stableStringify(before), after: stableStringify(after) });
    }
    return;
  }
  const keys = new Set([...Object.keys(before as Record<string, unknown>), ...Object.keys(after as Record<string, unknown>)]);
  for (const key of [...keys].sort()) {
    walkDiff((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], path ? `${path}.${key}` : key, out, added, removed);
  }
}

export function compareMissionBaselines(before: unknown, after: unknown): MissionBaselineComparison {
  const changedValues: MissionBaselineComparison['changedValues'] = [];
  const addedKeys: string[] = [];
  const removedKeys: string[] = [];
  walkDiff(before, after, '', changedValues, addedKeys, removedKeys);
  return {
    addedKeys,
    removedKeys,
    changedValues: changedValues.slice(0, 100),
    versionHashBefore: versionMissionConfig(before).versionHash,
    versionHashAfter: versionMissionConfig(after).versionHash,
  };
}
