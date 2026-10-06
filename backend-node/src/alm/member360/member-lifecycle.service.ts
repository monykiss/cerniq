import { Injectable } from '@nestjs/common';
import { MemberAccountCategory, MemberLifecycleStage } from '@prisma/client';
import { dataGap, type DataGap } from '../reports/data-gap';

/** The subset of MemberAccount fields the classifier actually needs — kept
 * narrow so this service has no compile-time dependency on Prisma's exact
 * Decimal type (callers pass plain numbers, already coerced). */
export interface AccountSignal {
  id: string;
  productType: string;
  category: MemberAccountCategory;
  balance: number;
  delinquencyDays: number | null;
  maturityDate: Date | null;
  openedDate: Date;
}

export interface LifecycleClassification {
  stage: MemberLifecycleStage;
  /** Plain-language reasons the classifier landed here — shown in the UI so
   * a stage is never an unexplained label. */
  reasons: string[];
}

export interface MemberRiskAssessment {
  /** 0-100, D1: null when there is nothing to score (no accounts at all) —
   * never a fabricated 0 or a neutral 50. */
  riskScore: number | null;
  /** Worst CECL stage (1/2/3) across LOAN accounts; null with no loans. */
  ceclStage: number | null;
  /** loans / (deposits + shares); the schema has no income field, so this
   * substitutes for a true DTI ratio rather than fabricating one — see the
   * ADR. Null when the member holds no deposit/share balance to divide by. */
  loanToDepositRatio: number | null;
  gaps: DataGap[];
}

export interface NextBestAction {
  id: string;
  priority: 'high' | 'medium' | 'low';
  titleEn: string;
  titleEs: string;
  /** Account this action concerns, when it's account-specific. */
  accountId?: string;
}

const CHARGED_OFF_NOTE =
  'CHARGED_OFF is never assigned by the classifier — it is a back-office ' +
  'decision with accounting consequences, not an inference from delinquency ' +
  'days. Reachable only through an explicit future admin action.';
void CHARGED_OFF_NOTE; // documentation anchor — see class doc comment

/**
 * Classifies a member's lifecycle stage and risk posture from their account
 * signals. Deliberately rule-based and disclosed, not an LLM call — every
 * threshold below is a named constant, exactly like `AssetEWSService`'s
 * 12-indicator composite and the PR macro-overlay's disclosed multipliers.
 * A "why did this member land here" question always has a literal answer in
 * `reasons[]`.
 *
 * {@link CHARGED_OFF_NOTE}
 */
@Injectable()
export class MemberLifecycleService {
  /** Days-past-due thresholds. Shared by stage classification AND CECL
   * staging so the two can never silently disagree about what "delinquent"
   * means. */
  static readonly DPD_AT_RISK = 1;
  static readonly DPD_DELINQUENT = 30;
  static readonly DPD_WORKOUT = 90;

  static readonly ONBOARDING_WINDOW_DAYS = 30;

  classifyStage(
    accounts: AccountSignal[],
    memberSince: Date,
    now: Date = new Date(),
  ): LifecycleClassification {
    const tenureDays = Math.floor(
      (now.getTime() - memberSince.getTime()) / 86_400_000,
    );

    if (
      accounts.length === 0 &&
      tenureDays <= MemberLifecycleService.ONBOARDING_WINDOW_DAYS
    ) {
      return {
        stage: MemberLifecycleStage.ONBOARDING,
        reasons: [
          `Joined ${tenureDays} day(s) ago with no product holdings yet`,
        ],
      };
    }

    const loans = accounts.filter(
      (a) => a.category === MemberAccountCategory.LOAN,
    );
    const totalBalance = accounts.reduce(
      (sum, a) => sum + Number(a.balance),
      0,
    );

    if (accounts.length === 0 || totalBalance === 0) {
      return {
        stage: MemberLifecycleStage.CHURNED,
        reasons: ['No open accounts with a positive balance'],
      };
    }

    const worstDpd = loans.reduce(
      (max, a) => Math.max(max, a.delinquencyDays ?? 0),
      0,
    );

    if (worstDpd >= MemberLifecycleService.DPD_WORKOUT) {
      return {
        stage: MemberLifecycleStage.WORKOUT,
        reasons: [`A loan is ${worstDpd} days past due (≥90 DPD threshold)`],
      };
    }
    if (worstDpd >= MemberLifecycleService.DPD_DELINQUENT) {
      return {
        stage: MemberLifecycleStage.DELINQUENT,
        reasons: [`A loan is ${worstDpd} days past due (30-89 DPD)`],
      };
    }
    if (worstDpd >= MemberLifecycleService.DPD_AT_RISK) {
      return {
        stage: MemberLifecycleStage.AT_RISK,
        reasons: [`A loan is ${worstDpd} day(s) past due (early delinquency)`],
      };
    }
    if (
      accounts.length === 1 &&
      accounts[0].category === MemberAccountCategory.SHARE &&
      tenureDays <= MemberLifecycleService.ONBOARDING_WINDOW_DAYS
    ) {
      return {
        stage: MemberLifecycleStage.ONBOARDING,
        reasons: ['Only the initial share deposit is on file so far'],
      };
    }

    return {
      stage: MemberLifecycleStage.ACTIVE,
      reasons: ['All accounts current, no open workout'],
    };
  }

  /** Per-account CECL stage from a KNOWN delinquency value — 1/2/3, never
   * null when delinquencyDays is known. Member-level ceclStage is the worst
   * of these across loans; see {@link assessRisk}. */
  private accountCeclStage(delinquencyDays: number): 1 | 2 | 3 {
    if (delinquencyDays >= MemberLifecycleService.DPD_WORKOUT) return 3;
    if (delinquencyDays >= MemberLifecycleService.DPD_DELINQUENT) return 2;
    return 1;
  }

  assessRisk(
    memberId: string,
    accounts: AccountSignal[],
  ): MemberRiskAssessment {
    const gaps: DataGap[] = [];

    if (accounts.length === 0) {
      gaps.push(
        dataGap('member.riskScore', 'MEMBER_RISK_SCORE_UNAVAILABLE', {
          severity: 'WARNING',
          action: 'No accounts on file for this member yet',
          context: { memberId },
        }),
      );
      return {
        riskScore: null,
        ceclStage: null,
        loanToDepositRatio: null,
        gaps,
      };
    }

    const loans = accounts.filter(
      (a) => a.category === MemberAccountCategory.LOAN,
    );
    const deposits = accounts.filter(
      (a) =>
        a.category === MemberAccountCategory.DEPOSIT ||
        a.category === MemberAccountCategory.SHARE,
    );

    const depositBalance = deposits.reduce((s, a) => s + Number(a.balance), 0);
    const loanBalance = loans.reduce((s, a) => s + Number(a.balance), 0);

    let loanToDepositRatio: number | null = null;
    if (depositBalance > 0) {
      loanToDepositRatio = Number((loanBalance / depositBalance).toFixed(4));
    } else if (loans.length > 0) {
      // Loans exist but there is nothing to divide by — this is a real,
      // disclosable state (an all-loan, no-deposit relationship), not a
      // missing input, so it gets a WARNING gap rather than a silent null.
      gaps.push(
        dataGap('member.loanToDepositRatio', 'MEMBER_ACCOUNTS_MISSING', {
          severity: 'WARNING',
          action:
            'Member has loan balances but no deposit/share balance on file',
          context: { memberId, loanBalance },
        }),
      );
    }

    let ceclStage: number | null = null;
    if (loans.length > 0) {
      ceclStage = loans.reduce((worst: number, a) => {
        if (a.delinquencyDays === null) return worst;
        return Math.max(worst, this.accountCeclStage(a.delinquencyDays));
      }, 1);
      const anyUnclassified = loans.some((a) => a.delinquencyDays === null);
      if (anyUnclassified) {
        gaps.push(
          dataGap('member.ceclStage', 'MEMBER_RISK_SCORE_UNAVAILABLE', {
            severity: 'WARNING',
            action: 'One or more loans have no delinquency data on file',
            context: { memberId },
          }),
        );
      }
    }

    // Disclosed 0-100 composite — same spirit as AssetEWSService's
    // 12-indicator composite: named weights, worse-than-reference-only
    // penalties, never a hidden formula. PROVISIONAL pending real-book
    // calibration, exactly like the PR PD multipliers were before W1.2.
    const worstDpd = loans.reduce(
      (max, a) => Math.max(max, a.delinquencyDays ?? 0),
      0,
    );
    const delinquencyPenalty = Math.min(60, worstDpd * 0.6); // caps at 60 pts by 100 DPD
    const leveragePenalty =
      loanToDepositRatio !== null ? Math.min(25, loanToDepositRatio * 10) : 0;
    const tenureCredit = deposits.length > 0 ? 5 : 0;
    const diversityCredit = accounts.length >= 3 ? 5 : 0;
    const riskScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          delinquencyPenalty + leveragePenalty - tenureCredit - diversityCredit,
        ),
      ),
    );

    return { riskScore, ceclStage, loanToDepositRatio, gaps };
  }

  computeNextBestActions(
    accounts: AccountSignal[],
    stage: MemberLifecycleStage,
    now: Date = new Date(),
  ): NextBestAction[] {
    const actions: NextBestAction[] = [];
    const THIRTY_DAYS_MS = 30 * 86_400_000;

    for (const account of accounts) {
      if (
        account.productType === 'certificado de depósito' &&
        account.maturityDate &&
        account.maturityDate.getTime() - now.getTime() <= THIRTY_DAYS_MS &&
        account.maturityDate.getTime() - now.getTime() >= 0
      ) {
        actions.push({
          id: `cd-renewal-${account.id}`,
          priority: 'medium',
          titleEn:
            'CD maturing within 30 days — send renewal offer with updated APR',
          titleEs:
            'Certificado vence en 30 días — enviar oferta de renovación con nueva tasa',
          accountId: account.id,
        });
      }

      if (
        account.category === MemberAccountCategory.LOAN &&
        (account.delinquencyDays ?? 0) === 0 &&
        now.getTime() - account.openedDate.getTime() >= 365 * 86_400_000
      ) {
        actions.push({
          id: `refi-offer-${account.id}`,
          priority: 'low',
          titleEn: `12+ months on-time on ${account.productType} — eligible for refinance review`,
          titleEs: `12+ meses al día en ${account.productType} — elegible para revisión de refinanciamiento`,
          accountId: account.id,
        });
      }
    }

    const hasLoan = accounts.some(
      (a) => a.category === MemberAccountCategory.LOAN,
    );
    const depositBalance = accounts
      .filter(
        (a) =>
          a.category === MemberAccountCategory.DEPOSIT ||
          a.category === MemberAccountCategory.SHARE,
      )
      .reduce((s, a) => s + Number(a.balance), 0);

    if (!hasLoan && depositBalance >= 5000) {
      actions.push({
        id: 'preapproved-credit-line',
        priority: 'medium',
        titleEn:
          'High-balance saver, no loan on file — pre-approve unsecured credit line',
        titleEs:
          'Ahorrador de saldo alto sin préstamo — pre-aprobar línea de crédito',
      });
    }

    if (
      stage === MemberLifecycleStage.AT_RISK ||
      stage === MemberLifecycleStage.DELINQUENT ||
      stage === MemberLifecycleStage.WORKOUT
    ) {
      actions.push({
        id: 'outreach-workout',
        priority: 'high',
        titleEn:
          'Delinquency signal present — outreach for a payment plan conversation',
        titleEs:
          'Señal de morosidad presente — contactar para conversación de plan de pago',
      });
    }

    return actions;
  }
}
