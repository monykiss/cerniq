import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TenorRateDto {
  @IsNumber()
  tenor: number; // in years (0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30)

  @IsNumber()
  rate: number; // as decimal (0.045 = 4.5%)
}

export class SaveYieldCurveDto {
  @IsString()
  institutionId: string;

  @IsString()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TenorRateDto)
  tenors: TenorRateDto[];

  @IsOptional()
  @IsString()
  source?: string;
}

export enum ShockType {
  PARALLEL_UP = 'parallel_up',
  PARALLEL_DOWN = 'parallel_down',
  STEEPENER = 'steepener',
  FLATTENER = 'flattener',
  SHORT_UP = 'short_up',
  SHORT_DOWN = 'short_down',
}

export class YieldCurveShockDto {
  @IsOptional()
  @IsString()
  curveId?: string; // if omitted, uses default US Treasury curve

  @IsString()
  shockType: string; // ShockType enum value or 'custom'

  @IsOptional()
  customShocks?: Record<string, number>; // tenor → bps shift for custom shocks
}
