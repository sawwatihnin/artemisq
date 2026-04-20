import {normalizeIteratee, type Iteratee} from './shared';

export default function minBy<T>(array: T[] | null | undefined, iteratee?: Iteratee<T>) {
  if (!array?.length) return undefined;
  const picker = normalizeIteratee(iteratee);
  return array.reduce((best, value) => {
    if (best === undefined) return value;
    return Number(picker(value)) < Number(picker(best)) ? value : best;
  }, array[0]);
}
