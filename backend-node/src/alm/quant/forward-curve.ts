// ─── ForwardCurve — Spot/Forward Rate Bootstrapping + Shocks ────
//
// Re-exports the ForwardCurve class from the HJM engine core.
// This file provides the public API at the quant/ level.
//
// ForwardCurve is the deterministic starting curve for HJM Monte Carlo.
// It bootstraps forward rates from spots:
//   f(T1, T2) = [r(T2)*T2 - r(T1)*T1] / (T2 - T1)
//
// API:
//   new ForwardCurve(spotRates)     — construct from spot rates
//   .toForwardRates()               — bootstrap forward rates
//   .shock(bps)                     — parallel shift
//   .twist(shortBps, longBps)       — slope shock (linear interpolation)
//   .withPRSpread()                 — apply PR municipal spread
//   .interpolate(tenor)             — arbitrary tenor interpolation
//   .toSnapshot()                   — serializable snapshot for MC input

export { ForwardCurve } from './hjm/forward-curve';
export type { ForwardCurveSnapshot } from './hjm/types';
export { HJM_TENORS, HJM_TENOR_LABELS } from './hjm/types';
