import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsNumber,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StressTestingParamsDto {
  @ApiPropertyOptional({
    description: 'Number of Monte Carlo simulation paths',
    example: 5000,
    minimum: 100,
    maximum: 10000,
  })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(10000)
  paths?: number;

  @ApiPropertyOptional({
    description: 'Simulation horizon in months',
    example: 12,
    minimum: 1,
    maximum: 60,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  horizon?: number;

  @ApiPropertyOptional({
    description: 'Interest rate volatility in basis points',
    example: 100,
    minimum: 1,
    maximum: 1000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  volatility?: number;

  @ApiPropertyOptional({
    description: 'Mean reversion speed parameter (Vasicek model)',
    example: 0.5,
    minimum: 0,
    maximum: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  meanReversion?: number;
}

export class CreateAnalysisRunDto {
  @ApiProperty({ description: 'Institution UUID to analyze' })
  @IsString()
  institutionId: string;

  @ApiPropertyOptional({
    description: 'Analysis type',
    enum: ['full_analysis'],
    default: 'full_analysis',
  })
  @IsOptional()
  @IsString()
  @IsIn(['full_analysis'])
  analysisType?: 'full_analysis';

  @ApiPropertyOptional({
    description: 'Who or what triggered this run',
    example: 'portal_user',
  })
  @IsOptional()
  @IsString()
  triggeredBy?: string;

  @ApiPropertyOptional({
    description: 'Model version identifier',
    example: 'v2.1',
  })
  @IsOptional()
  @IsString()
  modelVersion?: string;

  @ApiPropertyOptional({
    description: 'Named scenario set to apply',
    example: 'NCUA_2026',
  })
  @IsOptional()
  @IsString()
  scenarioSet?: string;

  @ApiPropertyOptional({
    description: 'Rate shocks in basis points',
    example: [-300, -200, -100, 0, 100, 200, 300],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  rateShocks?: number[];

  @ApiPropertyOptional({
    description: 'Custom assumptions for the analysis (freeform key-value)',
  })
  @IsOptional()
  @IsObject()
  assumptions?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Stress testing simulation parameters',
    type: StressTestingParamsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => StressTestingParamsDto)
  stressTesting?: StressTestingParamsDto;
}
