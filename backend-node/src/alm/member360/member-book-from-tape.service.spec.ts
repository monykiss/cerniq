import { Test } from '@nestjs/testing';

import { PrismaService } from '../../prisma.service';
import { LoanLifecycleService } from './loan-lifecycle.service';
import { MemberBookFromTapeService } from './member-book-from-tape.service';

const AS_OF = new Date('2026-06-30T00:00:00.000Z');

interface FakeLoanRow {
  externalLoanId: string;
  borrowerId: string | null;
  segmentName: string;
  balance: number;
  rate: number | null;
  originationDate: Date | null;
  maturityDate: Date | null;
  delinquencyDays: number | null;
}

function row(overrides: Partial<FakeLoanRow> = {}): FakeLoanRow {
  return {
    externalLoanId: 'L-1',
    borrowerId: 'B-1',
    segmentName: 'Auto Loan',
    balance: 12_000,
    rate: 0.07,
    originationDate: new Date('2024-01-10T00:00:00.000Z'),
    maturityDate: new Date('2029-01-10T00:00:00.000Z'),
    delinquencyDays: 0,
    ...overrides,
  };
}

/** Captures what the service tried to write, without a database. */
function makePrisma(rows: FakeLoanRow[]) {
  const createdAccounts: Record<string, unknown>[] = [];
  const upsertedMembers: Record<string, unknown>[] = [];
  const tx = {
    member: {
      upsert: jest.fn(async (args: { create: Record<string, unknown> }) => {
        upsertedMembers.push(args.create);
        return { id: `mem-${String(args.create.memberNumber)}` };
      }),
    },
    memberAccount: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        createdAccounts.push(args.data);
        return args.data;
      }),
    },
  };
  const prisma = {
    loanRecord: { findMany: jest.fn(async () => rows) },
    $transaction: jest.fn(
      async (fn: (t: typeof tx) => Promise<unknown>) => await fn(tx),
    ),
  };
  return { prisma, createdAccounts, upsertedMembers };
}

async function build(rows: FakeLoanRow[]) {
  const { prisma, createdAccounts, upsertedMembers } = makePrisma(rows);
  const moduleRef = await Test.createTestingModule({
    providers: [
      MemberBookFromTapeService,
      LoanLifecycleService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  const service = moduleRef.get(MemberBookFromTapeService);
  const result = await service.buildFromLoanTape('inst-1', AS_OF);
  return { result, createdAccounts, upsertedMembers };
}

describe('MemberBookFromTapeService', () => {
  it('projects a tape row into a member with a loan account', async () => {
    const { result, createdAccounts, upsertedMembers } = await build([row()]);
    expect(result.membersCreated).toBe(1);
    expect(result.accountsCreated).toBe(1);
    expect(upsertedMembers[0].memberNumber).toBe('B-1');
    expect(createdAccounts[0].externalLoanId).toBe('L-1');
  });

  it('marks ingested members as source="ingested", not fixture', async () => {
    const { upsertedMembers } = await build([row()]);
    expect(upsertedMembers[0].source).toBe('ingested');
  });

  it('groups several loans under one borrower', async () => {
    const { result } = await build([
      row({ externalLoanId: 'L-1', borrowerId: 'B-1', segmentName: 'Auto' }),
      row({
        externalLoanId: 'L-2',
        borrowerId: 'B-1',
        segmentName: 'hipoteca',
      }),
      row({ externalLoanId: 'L-3', borrowerId: 'B-2', segmentName: 'MBL' }),
    ]);
    expect(result.membersCreated).toBe(2);
    expect(result.accountsCreated).toBe(3);
  });

  it('resolves the canonical product code from the tape label', async () => {
    const { createdAccounts } = await build([
      row({ externalLoanId: 'L-1', segmentName: 'Auto Loan' }),
      row({
        externalLoanId: 'L-2',
        segmentName: 'hipotecario',
        borrowerId: 'B-2',
      }),
      row({
        externalLoanId: 'L-3',
        segmentName: 'Commercial and Industrial',
        borrowerId: 'B-3',
      }),
    ]);
    const codes = createdAccounts.map((a) => a.productCode);
    expect(codes).toContain('PRESTAMO_AUTO');
    expect(codes).toContain('HIPOTECA');
    expect(codes).toContain('PRESTAMO_COMERCIAL');
  });

  it('classifies each ingested loan through the lifecycle engine', async () => {
    const { createdAccounts } = await build([
      row({ externalLoanId: 'L-1', delinquencyDays: 0 }),
      row({ externalLoanId: 'L-2', borrowerId: 'B-2', delinquencyDays: 45 }),
      row({ externalLoanId: 'L-3', borrowerId: 'B-3', delinquencyDays: 120 }),
    ]);
    const stages = createdAccounts.map((a) => a.loanStage);
    expect(stages).toContain('CURRENT');
    expect(stages).toContain('DELINQUENT_30');
    expect(stages).toContain('NONACCRUAL');
  });

  describe('D1 — excluded rather than fabricated', () => {
    it('excludes rows with no borrower key and discloses the count', async () => {
      const { result } = await build([
        row({ externalLoanId: 'L-1' }),
        row({ externalLoanId: 'L-2', borrowerId: null }),
        row({ externalLoanId: 'L-3', borrowerId: '  ' }),
      ]);
      expect(result.loansExcludedNoBorrower).toBe(2);
      expect(result.accountsCreated).toBe(1);
      expect(result.gaps.some((g) => g.reason === 'NO_BORROWER_DATA')).toBe(
        true,
      );
    });

    it('never invents one member per unattributable loan', async () => {
      // Treating each orphan row as its own borrower would understate
      // single-borrower concentration — the hazard LoanRecord.borrowerId
      // documents.
      const { result } = await build([
        row({ externalLoanId: 'L-1', borrowerId: null }),
        row({ externalLoanId: 'L-2', borrowerId: null }),
      ]);
      expect(result.membersCreated).toBe(0);
    });

    it('excludes rows with no origination date rather than stamping the tape date', async () => {
      // Stamping asOfDate would make every such loan classify ORIGINATED.
      const { result, createdAccounts } = await build([
        row({ externalLoanId: 'L-1', originationDate: null }),
      ]);
      expect(result.loansExcludedNoOriginationDate).toBe(1);
      expect(createdAccounts).toHaveLength(0);
      expect(
        result.gaps.some((g) => g.reason === 'LOAN_TAPE_FIELD_MISSING'),
      ).toBe(true);
    });

    it('ingests an unmapped product but leaves its code null and discloses it', async () => {
      // The balance stays visible; only the pricing is withheld.
      const { result, createdAccounts } = await build([
        row({ segmentName: 'quantum widget financing' }),
      ]);
      expect(result.accountsCreated).toBe(1);
      expect(createdAccounts[0].productCode).toBeNull();
      expect(result.loansUnmappedProduct).toBe(1);
      expect(
        result.gaps.some((g) => g.reason === 'PRODUCT_TYPE_UNMAPPED'),
      ).toBe(true);
    });

    it('leaves loanStage null when the tape omitted delinquency', async () => {
      const { createdAccounts } = await build([row({ delinquencyDays: null })]);
      expect(createdAccounts[0].loanStage).toBeNull();
      expect(createdAccounts[0].cossecClassification).toBeNull();
    });

    it('always discloses that a loan tape carries no deposit side', async () => {
      const { result } = await build([row()]);
      const gap = result.gaps.find(
        (g) => g.reason === 'MEMBER_ACCOUNTS_MISSING',
      );
      expect(gap).toBeDefined();
      expect(gap?.action).toContain('deposit');
    });

    it('reports a critical gap when there is no tape at all', async () => {
      const { result } = await build([]);
      expect(result.membersCreated).toBe(0);
      expect(result.gaps.some((g) => g.severity === 'CRITICAL')).toBe(true);
    });
  });

  it('uses the earliest origination as the closest available membership date', async () => {
    const { upsertedMembers } = await build([
      row({
        externalLoanId: 'L-1',
        originationDate: new Date('2021-05-01T00:00:00.000Z'),
      }),
      row({
        externalLoanId: 'L-2',
        originationDate: new Date('2019-02-01T00:00:00.000Z'),
      }),
    ]);
    expect((upsertedMembers[0].memberSince as Date).toISOString()).toContain(
      '2019-02-01',
    );
  });

  it('is idempotent: re-running replaces the ingested accounts', async () => {
    const { prisma } = makePrisma([row()]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        MemberBookFromTapeService,
        LoanLifecycleService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    const service = moduleRef.get(MemberBookFromTapeService);
    await service.buildFromLoanTape('inst-1', AS_OF);
    await service.buildFromLoanTape('inst-1', AS_OF);
    // deleteMany scoped to externalLoanId != null runs on every pass, so a
    // re-ingest cannot accumulate duplicate loan rows.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
