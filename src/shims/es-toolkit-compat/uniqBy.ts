import {normalizeIteratee, type Iteratee} from './shared';

export default function uniqBy<T>(collection: T[] | null | undefined, iteratee?: Iteratee<T>) {
  if (!collection?.length) return [];
  const picker = normalizeIteratee(iteratee);
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of collection) {
    const key = JSON.stringify(picker(item));
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
