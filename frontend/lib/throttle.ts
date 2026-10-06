/**
 * Throttle utility — ensures a function runs at most once per interval.
 * Useful for scroll and resize handlers.
 */
export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  intervalMs: number,
): (...args: Args) => void {
  let lastTime = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (...args: Args) => {
    const now = Date.now();
    const remaining = intervalMs - (now - lastTime);

    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lastTime = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        lastTime = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  };
}
