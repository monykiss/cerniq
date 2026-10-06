/**
 * Lightweight className utility for conditional CSS classes.
 * Alternative to clsx/classnames when you want zero dependencies.
 */
export function cx(
  ...args: Array<string | false | null | undefined | Record<string, boolean>>
): string {
  const classes: string[] = [];

  for (const arg of args) {
    if (!arg) continue;
    if (typeof arg === 'string') {
      classes.push(arg);
    } else if (typeof arg === 'object') {
      for (const [key, value] of Object.entries(arg)) {
        if (value) classes.push(key);
      }
    }
  }

  return classes.join(' ');
}
