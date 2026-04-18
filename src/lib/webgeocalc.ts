const WEBGEOCALC_BASE = process.env.WEBGEOCALC_BASE_URL ?? 'https://wgc2.jpl.nasa.gov:8443/webgeocalc/api';

export interface WebGeoCalcMetadata {
  version?: string;
  description?: string;
  [key: string]: unknown;
}

export async function fetchWebGeoCalcMetadata(): Promise<WebGeoCalcMetadata> {
  const response = await fetch(WEBGEOCALC_BASE, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ARTEMIS-Q/1.0 (local mission console)',
    },
  });
  if (!response.ok) {
    throw new Error(`WebGeocalc HTTP ${response.status}`);
  }
  return response.json() as Promise<WebGeoCalcMetadata>;
}

export async function submitWebGeoCalcRequest(path: string, payload?: unknown, method: 'GET' | 'POST' = 'POST'): Promise<unknown> {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const url = `${WEBGEOCALC_BASE}/${normalizedPath}`;
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'ARTEMIS-Q/1.0 (local mission console)',
    },
    body: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
  });
  if (!response.ok) {
    throw new Error(`WebGeocalc HTTP ${response.status} for ${normalizedPath}`);
  }
  return response.json() as Promise<unknown>;
}
