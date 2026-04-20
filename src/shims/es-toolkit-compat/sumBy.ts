import {normalizeIteratee, type Iteratee} from './shared';

export default function sumBy<T>(collection: T[] | null | undefined, iteratee?: Iteratee<T>) {
  if (!collection?.length) return 0;
  const picker = normalizeIteratee(iteratee);
  return collection.reduce((sum, value) => sum + Number(picker(value) ?? 0), 0);
}
