/**
 * WCAG 2.1 color contrast utilities.
 * Use to verify that text colors meet accessibility requirements:
 *   - AA normal text: ratio >= 4.5
 *   - AA large text: ratio >= 3.0
 *   - AAA normal text: ratio >= 7.0
 */

/** Parse a hex color (#RGB or #RRGGBB) into [r, g, b] */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const expanded =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const num = parseInt(expanded, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** Compute relative luminance per WCAG 2.1 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** Compute contrast ratio between two hex colors */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(...hexToRgb(hex1));
  const l2 = relativeLuminance(...hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Check if contrast meets WCAG AA for normal text (>= 4.5:1) */
export function meetsAA(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= 4.5;
}

/** Check if contrast meets WCAG AAA for normal text (>= 7:1) */
export function meetsAAA(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= 7.0;
}
