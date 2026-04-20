export type Iteratee<T, R = unknown> =
  | ((value: T) => R)
  | keyof T
  | string
  | null
  | undefined;

export function getValueByPath<T>(target: T, path: string | string[] | undefined, defaultValue?: unknown): unknown {
  if (target == null || !path) return defaultValue;
  const segments = Array.isArray(path) ? path : path.split('.').filter(Boolean);
  let current: unknown = target;
  for (const segment of segments) {
    if (current == null || typeof current !== 'object' || !(segment in (current as Record<string, unknown>))) {
      return defaultValue;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current ?? defaultValue;
}

export function normalizeIteratee<T, R = unknown>(iteratee: Iteratee<T, R>): (value: T) => R | unknown {
  if (typeof iteratee === 'function') return iteratee;
  if (typeof iteratee === 'string') {
    return (value: T) => getValueByPath(value, iteratee);
  }
  if (iteratee == null) return (value: T) => value;
  return (value: T) => (value as Record<string, unknown>)[iteratee as keyof T];
}

export function comparePrimitive(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}
