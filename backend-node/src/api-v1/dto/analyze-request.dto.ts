import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsIn,
  ValidateNested,
  ArrayMinSize,
  Min,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BalanceSheetRowDto {
  @ApiProperty({
    description: 'Category: asset or liability',
    example: 'asset',
    enum: ['asset', 'liability'],
  })
  @IsString()
  @IsIn(['asset', 'liability'])
  category: string;

  @ApiProperty({
    description:
      'Subcategory (e.g., commercial_loans, residential_mortgages, savings_deposits, time_deposits)',
    example: 'commercial_loans',
  })
  @IsString()
  subcategory: string;

  @ApiProperty({
    description: 'Descriptive name for the line item',
    example: 'CRE - Retail Center Norte',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Balance in millions USD',
    example: 10.0,
  })
  @IsNumber()
  @Min(0)
  balance: number;

  @ApiProperty({
    description: 'Interest rate as percentage (e.g., 5.25 for 5.25%)',
    example: 5.25,
  })
  @IsNumber()
  rate: number;

  @ApiProperty({
    description: 'Macaulay duration in years',
    example: 4.5,
  })
  @IsNumber()
  @Min(0)
  duration: number;

  @ApiProperty({
    description: 'Rate type: fixed, variable, or hybrid',
    example: 'fixed',
    enum: ['fixed', 'variable', 'hybrid'],
  })
  @IsString()
  @IsIn(['fixed', 'variable', 'hybrid'])
  rateType: string;

  @ApiPropertyOptional({
    description: 'Next reprice date (ISO 8601)',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsString()
  repriceDate?: string;

  @ApiPropertyOptional({
    description: 'Maturity date (ISO 8601)',
    example: '2031-03-01',
  })
  @IsOptional()
  @IsString()
  maturityDate?: string;
}

export class AnalyzeRequestDto {
  @ApiProperty({
    description: 'Balance sheet line items (assets and liabilities)',
    type: [BalanceSheetRowDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BalanceSheetRowDto)
  rows: BalanceSheetRowDto[];

  @ApiProperty({
    description: 'Name of the institution being analyzed',
    example: 'Cooperativa de Ahorro y Credito Ejemplo Este',
  })
  @IsString()
  institutionName: string;

  @ApiProperty({
    description: 'Institution type',
    example: 'cooperativa',
    enum: [
      'cooperativa',
      'credit_union',
      'bank',
      'community_bank',
      'family_office',
    ],
  })
  @IsString()
  @IsIn([
    'cooperativa',
    'credit_union',
    'bank',
    'community_bank',
    'family_office',
  ])
  institutionType: string;

  @ApiProperty({
    description: 'Regulatory framework to apply',
    example: 'cossec',
    enum: ['cossec', 'ncua'],
  })
  @IsString()
  @IsIn(['cossec', 'ncua'])
  framework: string;

  @ApiProperty({
    description: 'Analysis period label (e.g., Q1-2026)',
    example: 'Q1-2026',
  })
  @IsString()
  period: string;

  @ApiPropertyOptional({
    description: 'Reporting date for the analysis (ISO 8601)',
    example: '2026-03-31',
  })
  @IsOptional()
  @IsDateString()
  reportingDate?: string;

  @ApiPropertyOptional({
    description: 'Custom rate shock scenarios in basis points',
    example: [-300, -200, -100, 0, 100, 200, 300],
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  rateShocksBps?: number[];
}
