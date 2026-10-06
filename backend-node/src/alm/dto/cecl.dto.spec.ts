import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  LoanSegmentDto,
  ImportLoanSegmentsDto,
  WARMCalculationDto,
} from './cecl.dto';

describe('cecl.dto', () => {
  describe('LoanSegmentDto', () => {
    it('validates a valid segment', async () => {
      const dto = plainToInstance(LoanSegmentDto, {
        segmentName: 'Auto Loans',
        balance: 50,
        weightedAvgRate: 0.055,
        weightedAvgMaturity: 3,
        historicalLossRate: 0.012,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('fails when required fields are missing', async () => {
      const dto = plainToInstance(LoanSegmentDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('ImportLoanSegmentsDto', () => {
    it('validates nested segments via @Type decorator', async () => {
      const dto = plainToInstance(ImportLoanSegmentsDto, {
        segments: [
          {
            segmentName: 'Mortgage',
            balance: 100,
            weightedAvgRate: 0.04,
            weightedAvgMaturity: 15,
            historicalLossRate: 0.005,
          },
        ],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.segments[0]).toBeInstanceOf(LoanSegmentDto);
    });

    it('fails when segments array is missing', async () => {
      const dto = plainToInstance(ImportLoanSegmentsDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('WARMCalculationDto', () => {
    it('validates with segments and optional macroScenario', async () => {
      const dto = plainToInstance(WARMCalculationDto, {
        segments: [
          {
            segmentName: 'CRE',
            balance: 200,
            weightedAvgRate: 0.06,
            weightedAvgMaturity: 5,
            historicalLossRate: 0.02,
          },
        ],
        macroScenario: 'adverse',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.segments[0]).toBeInstanceOf(LoanSegmentDto);
    });

    it('validates without macroScenario', async () => {
      const dto = plainToInstance(WARMCalculationDto, {
        segments: [
          {
            segmentName: 'Consumer',
            balance: 30,
            weightedAvgRate: 0.08,
            weightedAvgMaturity: 2,
            historicalLossRate: 0.03,
          },
        ],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
