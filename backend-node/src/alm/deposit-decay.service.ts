import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

/**
 * Deposit Decay / Non-Maturity Deposit (NMD) Runoff Service — Quant Model #42
 *
 * Models the behavioral maturity of deposits that have no contractual maturity:
 * - Regular savings, checking, money market accounts
 * - Member share accounts (cooperativa-specific)
 *
 * Uses exponential decay model: Balance(t) = Balance(0) × e^(-λt)
 * Where λ = decay rate (the per-product runoff assumption below).
 *
 * Critical for:
 * - EVE calculations (behavioral duration of liabilities)
 * - NSFR ASF factor determination
 * - Liquidity risk assessment
 * - COSSEC examination: "How long do your deposits actually stay?"
 *
 * D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): balances are read
 * from the institution's real balance-sheet liabilities. An institution with no
 * non-maturity deposit/share data returns an HONEST data_unavailable shell with
 * a CRITICAL gap — NEVER a fabricated demo curve. (This service formerly
 * returned an unconditional ~$12B getDemoDecay() for every institution.)
 */

export interface DepositDecayProduct {
  /** NMD decay class the balance-sheet rows were aggregated into. */
  subcategory: string;
  name: string;
  nameEs: string;
  balance: number;
  decayRate: number; // annual λ (platform-default assumption — see gaps[])
  halfLife: number; // years
  behavioralMaturity: number; // years (weighted average life)
  survivalCurve: Array<{
    year: number;
    pctRemaining: number;
    balance: number;
  }>;
}

export interface DepositDecayResult {
  products: DepositDecayProduct[];
  // Nullable per D1: with no NMD balances there is nothing to model, so the
  // engine returns `null` + a gap rather than a fabricated demo curve. `null`
  // is structurally distinct from a real `0` a regulator could act on.
  portfolioWeightedLife: number | null; // years
  portfolioHalfLife: number | null;
  totalNMDBalance: number | null;
  stableCorePct: number | null; // % of deposits classified as "core" (stable >1yr)
  interpretation: string | null;
  interpretationEs: string | null;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

// ─── Decay-rate assumptions (annual λ) ───────────────────────────────────
// PROVENANCE: λ mirrors the runoff rates calibrated in BehavioralDurationService
// (Hutchison-Pennacchi NMD model) so the platform uses ONE runoff source of
// truth. These are platform-default cold-start priors — NOT calibrated from an
// individual institution's historical outflow data — so every real-data
// computation discloses a WARNING gap (D1: defaults are configuration, never
// silently-fabricated institution data; mirrors the CECL registry-default
// disclosure in cecl.service.ts).
const NMD_DECAY: Record<
  string,
  { lambda: number; name: string; nameEs: string }
> = {
  savings: {
    lambda: 0.1,
    name: 'Savings / Member Shares',
    nameEs: 'Ahorro / Acciones de Socios',
  },
  share_drafts: {
    lambda: 0.09,
    name: 'Share Drafts',
    nameEs: 'Giros de Acciones',
  },
  demand: { lambda: 0.08, name: 'Checking', nameEs: 'Cuenta Corriente' },
  money_market: {
    lambda: 0.15,
    name: 'Money Market',
    nameEs: 'Mercado Monetario',
  },
};

// Stable, report-friendly product order.
const NMD_ORDER = ['savings', 'share_drafts', 'demand', 'money_market'];

@Injectable()
export class DepositDecayService {
  private readonly logger = new Logger(DepositDecayService.name);

  constructor(private readonly prisma: PrismaService) {}

  async analyzeDecay(institutionId: string): Promise<DepositDecayResult> {
    try {
      const items = await this.prisma.balanceSheetItem.findMany({
        where: { institutionId, category: 'liability' },
      });

      // Aggregate real liability balances into NMD decay classes. Time deposits
      // (contractual maturity) and borrowings are NOT non-maturity deposits —
      // they are excluded from the exponential runoff model by definition (the
      // interpretation names the NMD-only scope), never silently zeroed.
      const balances = new Map<string, number>();
      for (const item of items) {
        const cls = this.classifyDeposit(item.subcategory, item.name);
        if (cls === null || cls === 'time') continue;
        balances.set(cls, (balances.get(cls) ?? 0) + Number(item.balance));
      }

      const products: DepositDecayProduct[] = [];
      for (const key of NMD_ORDER) {
        const balance = balances.get(key) ?? 0;
        if (balance <= 0) continue;
        const a = NMD_DECAY[key];
        products.push(
          this.modelProduct(key, a.name, a.nameEs, balance, a.lambda),
        );
      }

      // D1 (never silent zeros): no non-maturity deposit/share balances means
      // there is nothing to model. Return an honest data_unavailable shell with
      // a CRITICAL gap — NEVER the former ~$12B getDemoDecay() fabrication.
      if (products.length === 0) {
        return this.dataUnavailableResult();
      }

      const totalBalance = products.reduce((s, p) => s + Number(p.balance), 0);
      const portfolioWeightedLife =
        products.reduce((s, p) => s + p.balance * p.behavioralMaturity, 0) /
        totalBalance;
      const portfolioHalfLife =
        products.reduce((s, p) => s + p.balance * p.halfLife, 0) / totalBalance;

      // Core deposits = those with behavioral maturity > 1 year.
      const coreBalance = products
        .filter((p) => p.behavioralMaturity > 1)
        .reduce((s, p) => s + Number(p.balance), 0);
      const stableCorePct = (coreBalance / totalBalance) * 100;

      return {
        products,
        portfolioWeightedLife: +portfolioWeightedLife.toFixed(2),
        portfolioHalfLife: +portfolioHalfLife.toFixed(2),
        totalNMDBalance: totalBalance,
        stableCorePct: +stableCorePct.toFixed(1),
        interpretation: `Portfolio weighted average life: ${portfolioWeightedLife.toFixed(1)} years across ${products.length} non-maturity deposit product(s). ${stableCorePct.toFixed(0)}% of NMD balances are classified as core (>1yr behavioral maturity), supporting an NSFR ASF factor of 0.90-0.95 for stable deposits. Decay rates are platform-default assumptions (see gap); contractual time deposits are excluded from this runoff model.`,
        interpretationEs: `Vida promedio ponderada del portafolio: ${portfolioWeightedLife.toFixed(1)} años en ${products.length} producto(s) de depósito sin vencimiento. ${stableCorePct.toFixed(0)}% de los saldos NMD se clasifican como fundamentales (>1 año de madurez conductual), respaldando un factor ASF NSFR de 0.90-0.95 para depósitos estables. Las tasas de fuga son supuestos por defecto (ver brecha); los certificados a plazo se excluyen de este modelo de fuga.`,
        status: 'ok',
        gaps: [
          dataGap('depositDecay.decayRate', 'COSSEC_INPUTS_INSUFFICIENT', {
            severity: 'WARNING',
            action:
              "Las tasas de fuga (λ) son la calibración provisional por defecto de la plataforma (modelo NMD Hutchison-Pennacchi), no calibradas con el historial de salidas de esta institución. Cargue el historial de saldos para una estimación definitiva. / Decay rates (λ) are the platform's provisional default calibration (Hutchison-Pennacchi NMD model), not calibrated from this institution's historical outflow data. Upload historical balances for a definitive estimate.",
            context: { source: 'NMD_DECAY platform defaults' },
          }),
        ],
      };
    } catch (error) {
      const e = error as Error;
      this.logger.error(`Computation failed: ${e.message}`, e.stack);
      Sentry.captureException(error);
      throw new InternalServerErrorException(
        'Computation failed. Please try again.',
      );
    }
  }

  /**
   * Map a balance-sheet liability row to an NMD decay class. Returns:
   *   - a decay-class key ('savings' | 'share_drafts' | 'demand' | 'money_market')
   *   - 'time'  for contractual time deposits / CDs (excluded from the model)
   *   - null    for non-deposit liabilities (borrowings, unknown)
   *
   * Granular subcategories (CSV ingestion taxonomy) are authoritative; the
   * coarse `deposits` subcategory and free-form rows are inferred from the
   * item name. Conservative: an unrecognized row is null (excluded), never
   * guessed into a product (D1).
   */
  private classifyDeposit(subcategory: string, name: string): string | null {
    switch ((subcategory ?? '').toLowerCase()) {
      case 'savings_deposits':
        return 'savings';
      case 'share_drafts':
        return 'share_drafts';
      case 'demand_deposits':
        return 'demand';
      case 'money_market':
        return 'money_market';
      case 'time_deposits':
        return 'time';
      case 'borrowings':
        return null;
    }
    // Coarse `deposits` / free-form rows: infer from the item name.
    const n = (name ?? '').toLowerCase();
    if (/money\s*market|mercado monetario/.test(n)) return 'money_market';
    if (/time|certificad|plazo|\bcds?\b/.test(n)) return 'time';
    if (/draft|giro/.test(n)) return 'share_drafts';
    if (/check|demand|corriente/.test(n)) return 'demand';
    if (/saving|ahorro|share|acci[oó]n|club|navidad/.test(n)) return 'savings';
    return null;
  }

  private modelProduct(
    subcategory: string,
    name: string,
    nameEs: string,
    balance: number,
    decayRate: number,
  ): DepositDecayProduct {
    const halfLife = Math.log(2) / decayRate;
    const behavioralMaturity = 1 / decayRate; // WAL for exponential decay
    const survivalCurve: Array<{
      year: number;
      pctRemaining: number;
      balance: number;
    }> = [];

    for (let y = 0; y <= 10; y++) {
      const pct = Math.exp(-decayRate * y) * 100;
      survivalCurve.push({
        year: y,
        pctRemaining: +pct.toFixed(1),
        balance: +((balance * pct) / 100),
      });
    }

    return {
      subcategory,
      name,
      nameEs,
      balance,
      decayRate,
      halfLife: +halfLife.toFixed(2),
      behavioralMaturity: +behavioralMaturity.toFixed(2),
      survivalCurve,
    };
  }

  // D1: the honest empty-data shell. Replaces the former getDemoDecay()
  // fabrication (~$12B of demo products: Regular Savings $4.2B, Share Accounts
  // $5.8B, Money Market $2.1B, …) that read as a real deposit base to a COSSEC
  // examiner on every call, for every institution.
  private dataUnavailableResult(): DepositDecayResult {
    return {
      products: [],
      portfolioWeightedLife: null,
      portfolioHalfLife: null,
      totalNMDBalance: null,
      stableCorePct: null,
      interpretation: null,
      interpretationEs: null,
      status: 'data_unavailable',
      gaps: [
        dataGap('depositDecay.nmdBalances', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue los pasivos de depósitos y acciones de socios (ahorro, giros, mercado monetario) para modelar la fuga conductual de depósitos (NMD runoff). / Load deposit and member-share liabilities (savings, share drafts, money market) to model behavioral deposit decay (NMD runoff).',
          context: { service: 'deposit-decay' },
        }),
      ],
    };
  }
}
