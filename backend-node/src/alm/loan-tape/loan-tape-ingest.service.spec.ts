import { LoanTapeIngestService } from './loan-tape-ingest.service';

const HEADER =
  'numero_prestamo,producto,saldo,tasa,fecha_originacion,fecha_vencimiento,tipo_garantia,valor_garantia,municipio,dias_mora,id_socio';

function tape(rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

const CLEAN_ROW =
  'L-001,Hipotecas,150000,6.5,2020-03-15,2050-03-15,residencial,200000,Caguas,0,S-100';

describe('LoanTapeIngestService — generic loan-tape CSV (W2.0 Slice 1)', () => {
  let prisma: {
    loanRecord: {
      count: jest.Mock;
      deleteMany: jest.Mock;
      createMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let svc: LoanTapeIngestService;

  beforeEach(() => {
    prisma = {
      loanRecord: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    // type-rationale: structural prisma test double
    svc = new LoanTapeIngestService(prisma as any);
  });

  describe('parseLoanTape (pure)', () => {
    it('parses bilingual headers into canonical fields', () => {
      const r = svc.parseLoanTape(tape([CLEAN_ROW]));
      expect(r.valid).toBe(true);
      const rec = r.records[0];
      expect(rec.externalLoanId).toBe('L-001');
      expect(rec.segmentName).toBe('Hipotecas');
      expect(rec.balance).toBe(150000);
      expect(rec.rate).toBeCloseTo(0.065, 6); // percent form auto-scaled
      expect(rec.originationDate).toBe('2020-03-15');
      expect(rec.maturityDate).toBe('2050-03-15');
      expect(rec.municipio).toBe('Caguas');
      expect(rec.delinquencyDays).toBe(0);
    });

    it('accepts English header aliases too', () => {
      const r = svc.parseLoanTape(
        'loan_id,segment,balance\nL-1,Auto Loans,25000',
      );
      expect(r.valid).toBe(true);
      expect(r.records[0].segmentName).toBe('Auto Loans');
    });

    it('parses the borrower key (id_socio) and counts missing ones (never imputed)', () => {
      const r = svc.parseLoanTape(
        tape([
          CLEAN_ROW, // id_socio = S-100
          'L-002,Hipotecas,90000,5.9,,,,,,,', // no id_socio
        ]),
      );
      expect(r.valid).toBe(true);
      expect(r.records[0].borrowerId).toBe('S-100');
      expect(r.records[1].borrowerId).toBeNull();
      const gap = r.gaps.find((g) => g.field === 'loanTape.borrowerId');
      expect(gap?.reason).toBe('LOAN_TAPE_FIELD_MISSING');
      expect(gap?.context).toMatchObject({ missingRows: 1 });
    });

    it('rejects a tape missing a required column, naming the aliases', () => {
      const r = svc.parseLoanTape('producto,saldo\nHipotecas,100');
      expect(r.valid).toBe(false);
      expect(r.errors[0].message).toContain('externalLoanId');
      expect(r.errors[0].messageEs).toContain('numero_prestamo');
    });

    it('MISSING optional field → null + LOAN_TAPE_FIELD_MISSING coverage gap (never imputed)', () => {
      const r = svc.parseLoanTape(
        tape([
          'L-001,Hipotecas,150000,6.5,,,,,,', // no dates/collateral/municipio/dpd
          'L-002,Hipotecas,90000,5.9,2021-01-01,2051-01-01,residencial,120000,Ponce,30',
        ]),
      );
      expect(r.valid).toBe(true);
      expect(r.records[0].municipio).toBeNull();
      expect(r.records[1].municipio).toBe('Ponce');
      const gap = r.gaps.find((g) => g.field === 'loanTape.municipio');
      expect(gap?.reason).toBe('LOAN_TAPE_FIELD_MISSING');
      expect(gap?.severity).toBe('WARNING');
      expect(gap?.context).toMatchObject({ missingRows: 1, totalRows: 2 });
    });

    it('GARBAGE in a present optional field → row ERROR (absent ≠ unparsable)', () => {
      const r = svc.parseLoanTape(
        tape(['L-001,Hipotecas,150000,notanumber,,,,,,']),
      );
      expect(r.valid).toBe(false);
      expect(r.errors[0].field).toBe('rate');
    });

    it('trailing-garbage balance never becomes a real number (D22 spine)', () => {
      const r = svc.parseLoanTape(tape(['L-001,Hipotecas,150000abc,,,,,,,']));
      expect(r.valid).toBe(false);
      expect(r.errors[0].field).toBe('balance');
    });

    it('duplicate loan id within a tape → row error', () => {
      const r = svc.parseLoanTape(tape([CLEAN_ROW, CLEAN_ROW]));
      expect(r.valid).toBe(false);
      expect(r.errors[0].message).toContain('Duplicate');
    });

    it('rejects impossible dates and maturity-before-origination', () => {
      const badDate = svc.parseLoanTape(
        tape(['L-1,Hipotecas,1000,,2026-02-30,,,,,']),
      );
      expect(badDate.valid).toBe(false);
      expect(badDate.errors[0].field).toBe('originationDate');

      const inverted = svc.parseLoanTape(
        tape(['L-1,Hipotecas,1000,,2030-01-01,2020-01-01,,,,']),
      );
      expect(inverted.valid).toBe(false);
      expect(inverted.errors[0].field).toBe('maturityDate');
    });

    it('decimal-form rate (0.065) is NOT double-scaled', () => {
      const r = svc.parseLoanTape(tape(['L-1,Hipotecas,1000,0.065,,,,,,']));
      expect(r.records[0].rate).toBeCloseTo(0.065, 6);
    });

    it('summary totals only count valid rows', () => {
      const r = svc.parseLoanTape(
        tape([CLEAN_ROW, 'L-002,Hipotecas,garbage,,,,,,,']),
      );
      expect(r.summary.totalRows).toBe(2);
      expect(r.summary.validRows).toBe(1);
      expect(r.summary.errorRows).toBe(1);
      expect(r.summary.totalBalance).toBe(150000);
    });
  });

  describe('ingestLoanTape (persistence)', () => {
    it('a clean tape transactionally REPLACES the date (delete + createMany)', async () => {
      prisma.loanRecord.count.mockResolvedValue(5);
      const res = await svc.ingestLoanTape(
        'inst-1',
        '2026-06-30',
        tape([CLEAN_ROW]),
      );
      expect(res.status).toBe('ingested');
      expect(res.persisted).toBe(1);
      expect(res.replaced).toBe(true);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.loanRecord.deleteMany).toHaveBeenCalledWith({
        where: {
          institutionId: 'inst-1',
          asOfDate: new Date('2026-06-30T00:00:00Z'),
        },
      });
      const createArg = prisma.loanRecord.createMany.mock.calls[0][0];
      expect(createArg.data[0]).toMatchObject({
        institutionId: 'inst-1',
        externalLoanId: 'L-001',
        municipio: 'Caguas',
      });
    });

    it('ALL-OR-NOTHING: one bad row rejects the upload and touches nothing', async () => {
      const res = await svc.ingestLoanTape(
        'inst-1',
        '2026-06-30',
        tape([CLEAN_ROW, 'L-002,Hipotecas,garbage,,,,,,,']),
      );
      expect(res.status).toBe('rejected');
      expect(res.persisted).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(res.parse.errors).toHaveLength(1); // the operator's fix list
    });

    it('rejects an invalid asOfDate without touching the DB', async () => {
      const res = await svc.ingestLoanTape(
        'inst-1',
        '06/30/2026',
        tape([CLEAN_ROW]),
      );
      expect(res.status).toBe('rejected');
      expect(res.parse.errors[0].field).toBe('asOfDate');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
