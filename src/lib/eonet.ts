const EONET_BASE = 'https://eonet.gsfc.nasa.gov/api/v3';

export interface EonetEvent {
  id: string;
  title: string;
  link?: string;
  closed?: string | null;
  categories?: Array<{ id: string; title: string }>;
  geometry?: Array<{ date?: string; type?: string; coordinates?: unknown }>;
  sources?: Array<{ id: string; url: string }>;
}

interface EonetResponse {
  events?: EonetEvent[];
  title?: string;
  description?: string;
  link?: string;
}

export interface EonetEventSummary {
  events: EonetEvent[];
  total: number;
  categoryCounts: Record<string, number>;
  source: string;
}

export async function fetchEonetEvents(params?: {
  status?: 'open' | 'closed' | 'all';
  limit?: number;
  days?: number;
  category?: string;
  source?: string;
  bbox?: string;
}): Promise<EonetEventSummary> {
  const url = new URL(`${EONET_BASE}/events`);
  if (params?.status) url.searchParams.set('status', params.status);
  if (params?.limit) url.searchParams.set('limit', String(params.limit));
  if (params?.days) url.searchParams.set('days', String(params.days));
  if (params?.category) url.searchParams.set('category', params.category);
  if (params?.source) url.searchParams.set('source', params.source);
  if (params?.bbox) url.searchParams.set('bbox', params.bbox);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ARTEMIS-Q/1.0 (local mission console)',
    },
  });
  if (!response.ok) {
    throw new Error(`EONET HTTP ${response.status}`);
  }
  const payload = await response.json() as EonetResponse;
  const events = payload.events ?? [];
  const categoryCounts = events.reduce<Record<string, number>>((acc, event) => {
    for (const category of event.categories ?? []) {
      acc[category.title] = (acc[category.title] ?? 0) + 1;
    }
    return acc;
  }, {});
  return {
    events,
    total: events.length,
    categoryCounts,
    source: 'LIVE · NASA EONET',
  };
}
