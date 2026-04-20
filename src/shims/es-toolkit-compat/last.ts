export default function last<T>(array: T[] | null | undefined): T | undefined {
  if (!array?.length) return undefined;
  return array[array.length - 1];
}
