export default function range(start: number, end?: number, step = 1): number[] {
  const result: number[] = [];
  let from = start;
  let to = end;
  if (to === undefined) {
    from = 0;
    to = start;
  }
  if (step === 0) return result;
  const direction = step > 0 ? 1 : -1;
  for (let value = from; direction > 0 ? value < (to as number) : value > (to as number); value += step) {
    result.push(value);
  }
  return result;
}
