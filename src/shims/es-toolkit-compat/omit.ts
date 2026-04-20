export default function omit<T extends Record<string, unknown>>(target: T, keys: Array<keyof T | string>) {
  const blocked = new Set(keys.map(String));
  return Object.fromEntries(Object.entries(target).filter(([key]) => !blocked.has(key))) as Partial<T>;
}
