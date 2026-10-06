import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Instrument ────────────────────────────────────────────────

export class InstrumentDto {
  @ApiProperty({
    description: 'Instrument name',
    example: '30-Year Fixed Mortgage',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Notional / principal amount in dollars',
    example: 5000000,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({
    description:
      'Annual coupon / interest rate as a decimal (e.g. 0.055 = 5.5%)',
    example: 0.055,
  })
  @IsNumber()
  rate: number;

  @ApiProperty({
    description: 'Years to maturity. 0 = overnight / demand',
    example: 10,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  maturityYears: number;

  @ApiProperty({
    description: 'True if the rate floats (reprices periodically)',
    example: false,
  })
  @IsBoolean()
  isFloating: boolean;

  @ApiPropertyOptional({
    description:
      'Months between repricings. 0 = overnight. Only relevant when isFloating = true',
    example: 12,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  repricingFrequencyMonths?: number;
}

// ─── Balance Sheet ─────────────────────────────────────────────

export class BalanceSheetDto {
  @ApiProperty({
    description: 'Array of asset instruments',
    type: [InstrumentDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InstrumentDto)
  assets: InstrumentDto[];

  @ApiProperty({
    description: 'Array of liability instruments',
    type: [InstrumentDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InstrumentDto)
  liabilities: InstrumentDto[];

  @ApiProperty({
    description: 'Total equity (assets minus liabilities)',
    example: 15000000,
  })
  @IsNumber()
  equity: number;
}

// ─── Scenario Request ──────────────────────────────────────────

export class ScenarioRequestDto {
  @ApiProperty({
    description: 'Balance sheet with assets, liabilities, and equity',
    type: BalanceSheetDto,
  })
  @ValidateNested()
  @Type(() => BalanceSheetDto)
  balanceSheet: BalanceSheetDto;

  @ApiPropertyOptional({
    description: 'Parallel rate shocks in basis points (default: -300 to +300)',
    example: [-300, -200, -100, 0, 100, 200, 300],
  })
  @IsOptional()
  @IsArray()
  rateShocks?: number[];
}

// ─── HQLA ─────────────────────────────────────────────────────

export class HQLADto {
  @ApiProperty({
    description:
      'Level 1 assets: cash, central bank reserves, sovereign debt (0% haircut)',
    example: 50000000,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  level1: number;

  @ApiProperty({
    description: 'Level 2A assets: agency MBS, covered bonds (15% haircut)',
    example: 20000000,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  level2a: number;

  @ApiProperty({
    description:
      'Level 2B assets: corporate bonds, equities (25% haircut, 40% cap on Level 2 total)',
    example: 5000000,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  level2b: number;
}

// ─── LCR Request ───────────────────────────────────────────────

export class LCRRequestDto {
  @ApiProperty({
    description: 'High Quality Liquid Assets breakdown',
    type: HQLADto,
  })
  @ValidateNested()
  @Type(() => HQLADto)
  hqla: HQLADto;

  @ApiProperty({
    description: 'Total net cash outflows over 30 calendar days',
    example: 40000000,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  totalNetOutflows: number;
}

// ─── Full Analysis Request ─────────────────────────────────────

export class FullAnalysisRequestDto {
  @ApiProperty({
    description: 'Balance sheet with assets, liabilities, and equity',
    type: BalanceSheetDto,
  })
  @ValidateNested()
  @Type(() => BalanceSheetDto)
  balanceSheet: BalanceSheetDto;

  @ApiPropertyOptional({
    description: 'Parallel rate shocks in basis points',
    example: [-300, -200, -100, 0, 100, 200, 300],
  })
  @IsOptional()
  @IsArray()
  rateShocks?: number[];

  @ApiPropertyOptional({
    description:
      'Optional LCR data; if omitted, LCR is derived from balance sheet',
    type: LCRRequestDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LCRRequestDto)
  lcr?: LCRRequestDto;
}

// ─── Result Types (not validated – outbound only) ──────────────

export interface InstrumentDetail {
  name: string;
  amount: number;
  rate: number;
  maturityYears: number;
  isFloating: boolean;
  macaulayDuration: number;
  modifiedDuration: number;
  bpv: number;
}

export interface DurationGapResult {
  assetDuration: number;
  liabilityDuration: number;
  durationGap: number;
  leverageAdjustedGap: number;
  totalAssets: number;
  totalLiabilities: number;
  interpretation: string;
  assetDetails: InstrumentDetail[];
  liabilityDetails: InstrumentDetail[];
}

export interface NIIScenario {
  shockBps: number;
  nii: number;
  change: number;
  changePct: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface NIIResult {
  baseNII: number;
  assetIncome: number;
  liabilityCost: number;
  scenarios: NIIScenario[];
}

export interface EVEScenario {
  shockBps: number;
  eve: number;
  change: number;
  changePct: number;
}

export interface EVEResult {
  baseEVE: number;
  scenarios: EVEScenario[];
}

export interface LCRResult {
  lcr: number;
  hqlaTotal: number;
  hqlaBreakdown: {
    level1: number;
    level2a: number;
    level2aAdjusted: number;
    level2b: number;
    level2bAdjusted: number;
    level2Cap: number;
    level2Applied: number;
  };
  totalNetOutflows: number;
  threshold: number;
  status: 'compliant' | 'warning' | 'breach';
}

export interface BPVInstrument {
  name: string;
  amount: number;
  bpv: number;
  modifiedDuration: number;
}

export interface BPVResult {
  totalAssetBPV: number;
  totalLiabilityBPV: number;
  netBPV: number;
  assetBPVs: BPVInstrument[];
  liabilityBPVs: BPVInstrument[];
  interpretation: string;
}

export interface FullAnalysisResult {
  summary: {
    totalAssets: number;
    totalLiabilities: number;
    equity: number;
    timestamp: string;
  };
  durationGap: DurationGapResult;
  niiSimulation: NIIResult;
  eve: EVEResult;
  bpv: BPVResult;
  lcr: LCRResult | null;
}
