import {
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  IsIn,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BalanceSheetItemDto {
  @ApiProperty({
    description: 'Balance sheet side',
    enum: ['asset', 'liability'],
    example: 'asset',
  })
  @IsString()
  @IsIn(['asset', 'liability'])
  category: string;

  @ApiProperty({
    description: 'Subcategory (e.g. loans, deposits, investments)',
    example: 'real_estate_loans',
  })
  @IsString()
  subcategory: string;

  @ApiProperty({
    description: 'Line item name',
    example: '30-Year Fixed Mortgages',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Current balance in base currency',
    example: 45000000,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  balance: number;

  @ApiProperty({
    description: 'Interest rate as a decimal (e.g. 0.065 = 6.5%)',
    example: 0.065,
  })
  @IsNumber()
  rate: number;

  @ApiProperty({
    description: 'Modified duration in years',
    example: 4.5,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  duration: number;

  @ApiPropertyOptional({
    description: 'Next repricing date (ISO 8601)',
    example: '2026-06-01',
  })
  @IsOptional()
  @IsDateString()
  repriceDate?: string;

  @ApiPropertyOptional({
    description: 'Maturity date (ISO 8601)',
    example: '2056-03-01',
  })
  @IsOptional()
  @IsDateString()
  maturityDate?: string;

  @ApiProperty({
    description: 'Interest rate type',
    enum: ['fixed', 'variable', 'hybrid'],
    example: 'fixed',
  })
  @IsString()
  @IsIn(['fixed', 'variable', 'hybrid'])
  rateType: string;
}

export class BulkBalanceSheetImportDto {
  @ApiProperty({
    description: 'Array of balance sheet line items to import',
    type: [BalanceSheetItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BalanceSheetItemDto)
  items: BalanceSheetItemDto[];
}
