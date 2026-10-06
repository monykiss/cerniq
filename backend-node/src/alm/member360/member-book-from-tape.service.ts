import { Injectable, Logger } from '@nestjs/common';
import { MemberAccountCategory, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma.service';
import { mapProductLabel } from '../cooperativa/product-mapping';
import { dataGap, type DataGap } from '../reports/data-gap';
import {
  LoanLifecycleService,
  type LoanSignal,
} from './loan-lifecycle.service';

/**
 * Builds a Member 360 book from REAL ingested loan tapes.
 *
 * This is the seam the Member 360 ADR named: `Member.source` defaults to
 * "fixture", and everything downstream (classifier, risk scorer, routes, UI)
 * is ingestion-source-agnostic. This service is the other side of that seam —
 * it produces the same Member/MemberAccount shape from `LoanRecord` rows, so
 * a cooperativa that can export a loan tape gets a populated Member 360
 * without a single change to any consuming surface.
 *
 * WHAT A LOAN TAPE CAN AND CANNOT TELL US
 * ---------------------------------------
 * A loan tape is an ASSET-side extract. It carries loans, not relationships,
 * so this service is deliberately honest about three limits:
 *
 *   1. NO DEPOSITS OR SHARES. A member built from a loan tape has loan
 *      accounts only. Their loan-to-deposit ratio is therefore not
 *      computable, and the classifier's CHURNED rule (totalBalance === 0)
 *      must not be read as "this socio left" — it only means the tape showed
 *      no outstanding principal. The gap says so.
 *   2. NO BORROWER NAMES. Tapes carry a borrower KEY, not PII. We display the
 *      key rather than inventing a name; `source = "ingested"` tells the UI
 *      (and any future reconciliation) that the display name is an identifier.
 *   3. NOT EVERY ROW IS ATTRIBUTABLE. Rows missing `borrowerId` cannot be
 *      assigned to a member at all, and rows missing `originationDate` have
 *      no honest `openedDate`. Both are EXCLUDED and DISCLOSED with counts,
 *      never silently dropped and never back-filled with the tape date —
 *      stamping `asOfDate` as the origination would make every such loan look
 *      brand new and classify it ORIGINATED, a systematic misread.
 *
 * The exclusion-with-disclosure pattern is the one `LoanRecord.borrowerId`
 * already documents for single-borrower concentration, and that
 * `ConcentrationService` already emits as NO_BORROWER_DATA.
 */
@Injectable()
export class MemberBookFromTapeService {
  private readonly logger = new Logger(MemberBookFromTapeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loanLifecycle: LoanLifecycleService,
  ) {}

  /**
   * Projects the loan tape for `institutionId` at `asOfDate` into the Member
   * 360 tables. Idempotent: re-running for the same tape date replaces the
   * ingested book rather than duplicating it.
   */
  async buildFromLoanTape(
    institutionId: string,
    asOfDate: Date,
  ): Promise<MemberBookBuildResult> {
    const gaps: DataGap[] = [];

    const records = await this.prisma.loanRecord.findMany({
      where: { institutionId, asOfDate },
      orderBy: { externalLoanId: 'asc' },
    });

    if (records.length === 0) {
      return {
        institutionId,
        asOfDate,
        membersCreated: 0,
        accountsCreated: 0,
        loansExcludedNoBorrower: 0,
        loansExcludedNoOriginationDate: 0,
        loansUnmappedProduct: 0,
        gaps: [
          dataGap('memberBook.loanTape', 'NO_LOAN_SEGMENTS', {
            severity: 'CRITICAL',
            action: `Ingest a loan tape for ${asOfDate.toISOString().slice(0, 10)} before building a member book from it.`,
            context: { institutionId },
          }),
        ],
      };
    }

    // ── Partition the tape into attributable and excluded rows ──
    const attributable: TapeRow[] = [];
    let excludedNoBorrower = 0;
    let excludedNoOrigination = 0;

    for (const r of records) {
      if (r.borrowerId === null || r.borrowerId.trim() === '') {
        excludedNoBorrower++;
        continue;
      }
      if (r.originationDate === null) {
        excludedNoOrigination++;
        continue;
      }
      attributable.push({
        externalLoanId: r.externalLoanId,
        borrowerId: r.borrowerId.trim(),
        segmentName: r.segmentName,
        // Prisma Decimal -> number at the boundary, exactly like every other
        // consumer of these services. Never arithmetic on a raw Decimal.
        balance: Number(r.balance),
        rate: r.rate === null ? null : Number(r.rate),
        originationDate: r.originationDate,
        maturityDate: r.maturityDate,
        delinquencyDays: r.delinquencyDays,
      });
    }

    if (excludedNoBorrower > 0) {
      gaps.push(
        dataGap('memberBook.borrowerId', 'NO_BORROWER_DATA', {
          severity: 'WARNING',
          action:
            `${excludedNoBorrower} loan(s) carry no borrower key and cannot be ` +
            'attributed to a member. Add a borrower/relationship column to the ' +
            'tape to include them.',
          context: { institutionId, excluded: excludedNoBorrower },
        }),
      );
    }

    if (excludedNoOrigination > 0) {
      gaps.push(
        dataGap('memberBook.originationDate', 'LOAN_TAPE_FIELD_MISSING', {
          severity: 'WARNING',
          action:
            `${excludedNoOrigination} loan(s) carry no origination date. They are ` +
            'excluded rather than stamped with the tape date, which would make ' +
            'them all classify as newly ORIGINATED.',
          context: { institutionId, excluded: excludedNoOrigination },
        }),
      );
    }

    // ── Group by borrower ──
    const byBorrower = new Map<string, TapeRow[]>();
    for (const row of attributable) {
      const existing = byBorrower.get(row.borrowerId);
      if (existing === undefined) byBorrower.set(row.borrowerId, [row]);
      else existing.push(row);
    }

    let unmappedProduct = 0;
    let accountsCreated = 0;

    for (const [borrowerId, rows] of byBorrower) {
      // Earliest origination across the borrower's loans is the closest thing
      // a loan tape offers to a membership date. Labelled as such rather than
      // presented as a true join date.
      const memberSince = rows.reduce(
        (earliest, r) =>
          r.originationDate < earliest ? r.originationDate : earliest,
        rows[0].originationDate,
      );

      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const member = await tx.member.upsert({
          where: {
            institutionId_memberNumber: {
              institutionId,
              memberNumber: borrowerId,
            },
          },
          create: {
            institutionId,
            memberNumber: borrowerId,
            // The borrower KEY, not a name — tapes carry no PII. `source`
            // marks this so the UI never presents it as a person's name.
            fullName: borrowerId,
            memberSince,
            source: 'ingested',
          },
          update: { memberSince, source: 'ingested' },
        });

        // Replace this member's ingested accounts for the tape date rather
        // than accumulating duplicates across re-runs.
        await tx.memberAccount.deleteMany({
          where: { memberId: member.id, externalLoanId: { not: null } },
        });

        for (const row of rows) {
          const match = mapProductLabel(row.segmentName);
          if (match === null) unmappedProduct++;

          const signal: LoanSignal = {
            id: row.externalLoanId,
            productCode: match?.productType ?? null,
            balance: row.balance,
            originalPrincipal: null,
            delinquencyDays: row.delinquencyDays,
            openedDate: row.originationDate,
            maturityDate: row.maturityDate,
          };
          const classification = this.loanLifecycle.classifyLoan(
            signal,
            asOfDate,
          );
          gaps.push(...classification.gaps);

          await tx.memberAccount.create({
            data: {
              memberId: member.id,
              institutionId,
              productType: row.segmentName,
              productCode: match?.productType ?? null,
              category: MemberAccountCategory.LOAN,
              balance: row.balance,
              originalPrincipal: null,
              interestRate: row.rate,
              delinquencyDays: row.delinquencyDays,
              maturityDate: row.maturityDate,
              openedDate: row.originationDate,
              cossecClassification: classification.cossecClassification,
              loanStage: classification.stage,
              externalLoanId: row.externalLoanId,
            },
          });
          accountsCreated++;
        }
      });
    }

    if (unmappedProduct > 0) {
      gaps.push(
        dataGap('memberBook.productCode', 'PRODUCT_TYPE_UNMAPPED', {
          severity: 'WARNING',
          action:
            `${unmappedProduct} loan(s) carry a product label that does not map ` +
            'to the cooperativa product registry. They are ingested with a null ' +
            'product code — their balances are visible but they cannot be priced ' +
            'or entered into CECL until the label is mapped.',
          context: { institutionId, unmapped: unmappedProduct },
        }),
      );
    }

    // A loan tape has no liability side. Say so once, at the book level, so
    // nobody reads a missing deposit balance as a zero one.
    gaps.push(
      dataGap('memberBook.deposits', 'MEMBER_ACCOUNTS_MISSING', {
        severity: 'WARNING',
        action:
          'This book was built from a loan tape, which carries no share or ' +
          'deposit accounts. Loan-to-deposit ratios are not computable and a ' +
          'zero total balance does not indicate a churned member.',
        context: { institutionId, source: 'ingested' },
      }),
    );

    this.logger.log(
      `Built member book from loan tape for ${institutionId}: ` +
        `${byBorrower.size} member(s), ${accountsCreated} account(s), ` +
        `${excludedNoBorrower + excludedNoOrigination} loan(s) excluded`,
    );

    return {
      institutionId,
      asOfDate,
      membersCreated: byBorrower.size,
      accountsCreated,
      loansExcludedNoBorrower: excludedNoBorrower,
      loansExcludedNoOriginationDate: excludedNoOrigination,
      loansUnmappedProduct: unmappedProduct,
      gaps,
    };
  }
}

interface TapeRow {
  externalLoanId: string;
  borrowerId: string;
  segmentName: string;
  balance: number;
  rate: number | null;
  originationDate: Date;
  maturityDate: Date | null;
  delinquencyDays: number | null;
}

export interface MemberBookBuildResult {
  institutionId: string;
  asOfDate: Date;
  membersCreated: number;
  accountsCreated: number;
  /** Excluded: no borrower key, so not attributable to any member. */
  loansExcludedNoBorrower: number;
  /** Excluded: no origination date, so no honest openedDate. */
  loansExcludedNoOriginationDate: number;
  /** Ingested, but with a null product code pending a registry mapping. */
  loansUnmappedProduct: number;
  gaps: DataGap[];
}
