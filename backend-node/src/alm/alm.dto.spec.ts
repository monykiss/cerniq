import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  InstrumentDto,
  BalanceSheetDto,
  ScenarioRequestDto,
  HQLADto,
  LCRRequestDto,
  FullAnalysisRequestDto,
} from './alm.dto';

describe('ALM DTOs', () => {
  // ── InstrumentDto ──────────────────────────────────────────────

  describe('InstrumentDto', () => {
    it('validates a correct instrument', async () => {
      const dto = plainToInstance(InstrumentDto, {
        name: '30-Year Fixed Mortgage',
        amount: 5000000,
        rate: 0.055,
        maturityYears: 30,
        isFloating: false,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('validates with optional repricingFrequencyMonths', async () => {
      const dto = plainToInstance(InstrumentDto, {
        name: 'ARM',
        amount: 1000000,
        rate: 0.04,
        maturityYears: 15,
        isFloating: true,
        repricingFrequencyMonths: 12,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('fails when name is missing', async () => {
      const dto = plainToInstance(InstrumentDto, {
        amount: 1000000,
        rate: 0.04,
        maturityYears: 10,
        isFloating: false,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('fails when amount is negative', async () => {
      const dto = plainToInstance(InstrumentDto, {
        name: 'Test',
        amount: -100,
        rate: 0.04,
        maturityYears: 10,
        isFloating: false,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('fails when maturityYears is negative', async () => {
      const dto = plainToInstance(InstrumentDto, {
        name: 'Test',
        amount: 1000,
        rate: 0.04,
        maturityYears: -1,
        isFloating: false,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('allows amount of 0', async () => {
      const dto = plainToInstance(InstrumentDto, {
        name: 'Zero',
        amount: 0,
        rate: 0,
        maturityYears: 0,
        isFloating: false,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  // ── BalanceSheetDto ────────────────────────────────────────────

  describe('BalanceSheetDto', () => {
    const validAsset = {
      name: 'Loans',
      amount: 5000000,
      rate: 0.06,
      maturityYears: 10,
      isFloating: false,
    };
    const validLiability = {
      name: 'Deposits',
      amount: 4000000,
      rate: 0.02,
      maturityYears: 2,
      isFloating: false,
    };

    it('validates a correct balance sheet', async () => {
      const dto = plainToInstance(BalanceSheetDto, {
        assets: [validAsset],
        liabilities: [validLiability],
        equity: 1000000,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('fails with empty assets array', async () => {
      const dto = plainToInstance(BalanceSheetDto, {
        assets: [],
        liabilities: [validLiability],
        equity: 1000000,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('fails with empty liabilities array', async () => {
      const dto = plainToInstance(BalanceSheetDto, {
        assets: [validAsset],
        liabilities: [],
        equity: 1000000,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('transforms nested instruments', async () => {
      const dto = plainToInstance(BalanceSheetDto, {
        assets: [validAsset, validAsset],
        liabilities: [validLiability],
        equity: 2000000,
      });
      expect(dto.assets).toHaveLength(2);
      expect(dto.assets[0]).toBeInstanceOf(InstrumentDto);
    });
  });

  // ── ScenarioRequestDto ─────────────────────────────────────────

  describe('ScenarioRequestDto', () => {
    const validBalanceSheet = {
      assets: [
        {
          name: 'A',
          amount: 1000,
          rate: 0.05,
          maturityYears: 5,
          isFloating: false,
        },
      ],
      liabilities: [
        {
          name: 'L',
          amount: 800,
          rate: 0.02,
          maturityYears: 2,
          isFloating: false,
        },
      ],
      equity: 200,
    };

    it('validates with balance sheet only', async () => {
      const dto = plainToInstance(ScenarioRequestDto, {
        balanceSheet: validBalanceSheet,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('validates with optional rate shocks', async () => {
      const dto = plainToInstance(ScenarioRequestDto, {
        balanceSheet: validBalanceSheet,
        rateShocks: [-300, -200, -100, 0, 100, 200, 300],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  // ── HQLADto ────────────────────────────────────────────────────

  describe('HQLADto', () => {
    it('validates correct HQLA', async () => {
      const dto = plainToInstance(HQLADto, {
        level1: 50000000,
        level2a: 20000000,
        level2b: 5000000,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('fails with negative level1', async () => {
      const dto = plainToInstance(HQLADto, {
        level1: -1,
        level2a: 0,
        level2b: 0,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  // ── LCRRequestDto ──────────────────────────────────────────────

  describe('LCRRequestDto', () => {
    it('validates correct LCR request', async () => {
      const dto = plainToInstance(LCRRequestDto, {
        hqla: { level1: 50e6, level2a: 20e6, level2b: 5e6 },
        totalNetOutflows: 40e6,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('fails with negative outflows', async () => {
      const dto = plainToInstance(LCRRequestDto, {
        hqla: { level1: 50e6, level2a: 20e6, level2b: 5e6 },
        totalNetOutflows: -1,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  // ── FullAnalysisRequestDto ─────────────────────────────────────

  describe('FullAnalysisRequestDto', () => {
    const validBS = {
      assets: [
        {
          name: 'A',
          amount: 1000,
          rate: 0.05,
          maturityYears: 5,
          isFloating: false,
        },
      ],
      liabilities: [
        {
          name: 'L',
          amount: 800,
          rate: 0.02,
          maturityYears: 2,
          isFloating: false,
        },
      ],
      equity: 200,
    };

    it('validates with balance sheet only', async () => {
      const dto = plainToInstance(FullAnalysisRequestDto, {
        balanceSheet: validBS,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('validates with all optional fields', async () => {
      const dto = plainToInstance(FullAnalysisRequestDto, {
        balanceSheet: validBS,
        rateShocks: [-100, 0, 100],
        lcr: {
          hqla: { level1: 10e6, level2a: 5e6, level2b: 1e6 },
          totalNetOutflows: 8e6,
        },
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('validates without lcr (optional)', async () => {
      const dto = plainToInstance(FullAnalysisRequestDto, {
        balanceSheet: validBS,
        rateShocks: [-100, 100],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
