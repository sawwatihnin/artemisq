type AnyFn = (...args: unknown[]) => void;

export default function throttle<T extends AnyFn>(fn: T, wait = 0): T {
  let lastCall = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let trailingArgs: unknown[] | undefined;

  return ((...args: unknown[]) => {
    const now = Date.now();
    const remaining = wait - (now - lastCall);
    trailingArgs = args;
    if (remaining <= 0) {
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
      lastCall = now;
      fn(...args);
      trailingArgs = undefined;
      return;
    }
    if (!timeout) {
      timeout = setTimeout(() => {
        lastCall = Date.now();
        timeout = undefined;
        const pending = trailingArgs;
        trailingArgs = undefined;
        if (pending) fn(...pending);
      }, remaining);
    }
  }) as T;
}
