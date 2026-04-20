import {comparePrimitive, normalizeIteratee, type Iteratee} from './shared';

export default function sortBy<T>(collection: T[] | null | undefined, iteratees?: Iteratee<T> | Array<Iteratee<T>>) {
  if (!collection) return [];
  const list = Array.isArray(iteratees) ? iteratees : [iteratees];
  const pickers = list.map((iteratee) => normalizeIteratee(iteratee));
  return [...collection].sort((left, right) => {
    for (const picker of pickers) {
      const comparison = comparePrimitive(picker(left), picker(right));
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}
