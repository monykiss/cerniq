import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LoanSegmentDto {
  @IsString()
  segmentName: string;

  @IsNumber()
  balance: number; // in millions

  @IsNumber()
  weightedAvgRate: number; // decimal

  @IsNumber()
  weightedAvgMaturity: number; // years

  @IsNumber()
  historicalLossRate: number; // annualized decimal

  @IsOptional()
  @IsNumber()
  lgd?: number; // loss given default (0-1)

  @IsOptional()
  @IsNumber()
  qualitativeAdj?: number; // +/- adjustment

  @IsOptional()
  @IsNumber()
  discountRate?: number; // PV discount rate for FASB 326 (default 0.03)
}

export class ImportLoanSegmentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoanSegmentDto)
  segments: LoanSegmentDto[];
}

export class WARMCalculationDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoanSegmentDto)
  segments: LoanSegmentDto[];

  @IsOptional()
  @IsString()
  macroScenario?: string; // baseline | adverse | severely_adverse
}
