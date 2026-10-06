// CERNIQ Design Token System — Single source of truth for all UI values
// Usage: import { tokens } from '@/lib/design-tokens'

export const tokens = {
  color: {
    brand: {
      electric: '#004EE5',   // primary action, links, icons, CTAs
      signal: '#009E3A',     // success, PASS, positive delta
      amber: '#D97706',      // warning, WATCH, pending actions
      red: '#B91C1C',        // danger, BREACH, error states
      nearblack: '#050C1C',  // primary text, headings
    },
    surface: {
      base: '#FFFFFF',       // page background
      elevated: '#F4F7FF',   // card backgrounds
      inset: '#EEF3FF',      // inputs, table alt rows
      dark: '#050C1C',       // code blocks, dark panels
    },
    camel: {
      1: '#009E3A',          // Strong (1)
      2: '#16A34A',          // Satisfactory (2)
      3: '#D97706',          // Fair (3)
      4: '#C2410C',          // Marginal (4)
      5: '#B91C1C',          // Unsatisfactory (5)
    },
    status: {
      pass: '#009E3A',
      watch: '#D97706',
      warning: '#EA580C',
      breach: '#B91C1C',
      compliant: '#009E3A',
    },
  },
  spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 },
  radius: { sm: '4px', md: '8px', lg: '12px', xl: '16px', full: '9999px' },
  shadow: {
    sm: '0 1px 3px rgba(5,12,28,0.08)',
    md: '0 4px 12px rgba(5,12,28,0.10)',
    lg: '0 8px 24px rgba(5,12,28,0.12)',
    glow: '0 0 0 3px rgba(0,78,229,0.20)',
  },
  font: {
    size: { xs: 11, sm: 13, base: 15, md: 17, lg: 20, xl: 24, '2xl': 30, '3xl': 36 },
    weight: { normal: 400, medium: 500, semibold: 600, bold: 700 },
    family: { sans: 'Inter, system-ui, sans-serif', mono: 'JetBrains Mono, monospace' },
  },
  chart: {
    colors: ['#06b6d4', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#ec4899'],
    grid: '#f1f5f9',
    tooltip: { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 },
  },
} as const;

export type DesignTokens = typeof tokens;
