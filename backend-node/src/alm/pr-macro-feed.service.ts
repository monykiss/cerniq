import { Injectable, Logger } from '@nestjs/common';
import { parseFinancialField } from '../common/utils/financial-field';
import {
  PR_MACRO_SNAPSHOT,
  type PrMacroSeriesProvenance,
} from './data/macro/pr-macro-snapshot';
import type { PrMacroInputs } from './macro-overlay.service';
import { resolveMacroStalenessDays } from './macro-overlay-config.util';
import type { DataGap } from './reports/data-gap';

/**
 * PR macro-data feed (Wave 1, W1.2 Slice 2) — serves the macro inputs that
 * `MacroOverlayService.deriveCurrentOverlay` turns into the CECL overlay.
 *
 * Layered source, honest at every layer (D1 — this is the first feed in the
 * repo that emits DataGaps instead of silently falling back; treasury-rates
 * and market-data-feed predate the convention):
 *
 *   1. COMMITTED SNAPSHOT (always available, deterministic): the typed
 *      `PR_MACRO_SNAPSHOT` module, compiled into the build with per-series
 *      provenance. Past `PR_MACRO_STALENESS_DAYS` (default 120) the feed
 *      emits a STALE_SNAPSHOT WARNING gap but keeps serving the data —
 *      partial + disclosed, never refuse.
 *   2. FRED LIVE REFRESH (optional, unemployment only): when FRED_API_KEY is
 *      set, the PRURN series (BLS LAUS via FRED — the canonical exposed form;
 *      the raw BLS series-ID prefix is unresolved per market research notes §10.2)
 *      overrides the snapshot's unemployment value, cached 4h like
 *      treasury-rates. A failed refresh falls back to the snapshot WITH a
 *      WARNING gap — never silently.
 *
 * HPI (FHFA quarterly) and net migration (Census annual) have no live path
 * yet — they refresh via the snapshot's operator protocol (see
 * pr-macro-snapshot.ts). Their update cadence is quarterly/annual, so a
 * committed, reviewed value with disclosed asOf beats a scraped one.
 *
 * `nowFn` is a public test seam: goldens and specs pin it so staleness
 * evaluation is deterministic; production uses real time.
 */

export interface PrMacroFeedSnapshot {
  inputs: PrMacroInputs;
  compiledAsOf: string;
  basis: 'committed-snapshot' | 'committed-snapshot+fred-refresh';
  series: PrMacroSeriesProvenance[];
  gaps: DataGap[];
  provenance: string;
}

const FRED_CACHE_TTL_MS = 4 * 3600 * 1000;
const FRED_TIMEOUT_MS = 5000;

@Injectable()
export class PrMacroFeedService {
  private readonly logger = new Logger(PrMacroFeedService.name);

  /** Test seam: pin for deterministic staleness (goldens/specs). */
  nowFn: () => Date = () => new Date();

  private fredCache: { valuePct: number; asOf: string } | null = null;
  private fredCacheAtMs = 0;

  async getSnapshot(): Promise<PrMacroFeedSnapshot> {
    const snap = PR_MACRO_SNAPSHOT;
    const gaps: DataGap[] = [];
    const now = this.nowFn();

    // ── Staleness of the committed snapshot (verification-pass age) ──
    const thresholdDays = resolveMacroStalenessDays();
    const ageDays = Math.floor(
      (now.getTime() - new Date(`${snap.compiledAsOf}T00:00:00Z`).getTime()) /
        86_400_000,
    );
    if (ageDays > thresholdDays) {
      gaps.push({
        field: 'cecl.macroOverlay.snapshot',
        reason: 'STALE_SNAPSHOT',
        severity: 'WARNING',
        action: `El snapshot macro de PR fue verificado el ${snap.compiledAsOf} (hace ${ageDays} días, umbral ${thresholdDays}); re-verificar las series contra BLS/FHFA/Census y actualizar pr-macro-snapshot.ts. / The PR macro snapshot was verified ${snap.compiledAsOf} (${ageDays} days ago, threshold ${thresholdDays}); re-verify the series against BLS/FHFA/Census and update pr-macro-snapshot.ts.`,
        context: {
          compiledAsOf: snap.compiledAsOf,
          ageDays,
          thresholdDays,
        },
      });
    }

    // ── Optional FRED live refresh (unemployment only) ──
    let inputs: PrMacroInputs = {
      ...snap.inputs,
      asOf: snap.compiledAsOf,
    };
    let basis: PrMacroFeedSnapshot['basis'] = 'committed-snapshot';
    let refreshNote = '';

    const fredApiKey = process.env.FRED_API_KEY;
    if (fredApiKey) {
      try {
        const fresh = await this.fetchFredUnemployment(fredApiKey, now);
        inputs = { ...inputs, prUnemploymentPct: fresh.valuePct };
        basis = 'committed-snapshot+fred-refresh';
        refreshNote = ` Desempleo refrescado en vivo vía FRED:PRURN (${fresh.valuePct}%, ${fresh.asOf}). / Unemployment live-refreshed via FRED:PRURN (${fresh.valuePct}%, ${fresh.asOf}).`;
      } catch (err) {
        this.logger.warn(
          `FRED PRURN refresh failed, serving committed snapshot value: ${err}`,
        );
        gaps.push({
          field: 'cecl.macroOverlay.unemployment',
          reason: 'STALE_SNAPSHOT',
          severity: 'WARNING',
          action:
            'FRED_API_KEY está configurado pero el refresco en vivo de PRURN falló — se usa el valor de desempleo del snapshot comprometido. / FRED_API_KEY is set but the live PRURN refresh failed — using the committed snapshot unemployment value.',
          context: { refresh: 'FRED:PRURN', error: String(err) },
        });
      }
    }

    return {
      inputs,
      compiledAsOf: snap.compiledAsOf,
      basis,
      series: snap.series,
      gaps,
      provenance: `Fuente: snapshot comprometido pr-macro-snapshot (verificado ${snap.compiledAsOf}; BLS LAUS, FHFA HPI, Census Vintage 2025 — procedencia por serie en el módulo).${refreshNote} / Source: committed pr-macro-snapshot (verified ${snap.compiledAsOf}; per-series provenance in the module).${refreshNote}`,
    };
  }

  // ─── internals ───

  /**
   * Latest PRURN observation (PR unemployment %, seasonally adjusted).
   * Deadline-bounded (5s abort) per the runtime-deadline rule; cached 4h
   * (treasury-rates pattern) against the injectable clock.
   */
  private async fetchFredUnemployment(
    apiKey: string,
    now: Date,
  ): Promise<{ valuePct: number; asOf: string }> {
    if (
      this.fredCache &&
      now.getTime() - this.fredCacheAtMs < FRED_CACHE_TTL_MS
    ) {
      return this.fredCache;
    }

    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=PRURN&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FRED_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`FRED PRURN returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      observations?: Array<{ date?: string; value?: string }>;
    };
    const obs = data.observations?.[0];
    // Same sanity bounds as MacroOverlayService.validateInputs (0–40%).
    const valuePct = parseFinancialField(obs?.value, { min: 0, max: 40 });
    if (valuePct === null || !obs?.date) {
      throw new Error('FRED PRURN returned no parsable observation');
    }

    this.fredCache = { valuePct, asOf: obs.date };
    this.fredCacheAtMs = now.getTime();
    return this.fredCache;
  }
}
