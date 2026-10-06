import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// These are documentation-only DTOs for Swagger.
// The actual response shapes come from the ALM engine services.

export class CossecRatioResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Capital Adequacy' })
  name: string;

  @ApiProperty({ example: 'Suficiencia de Capital' })
  nameEs: string;

  @ApiProperty({ example: 10.81 })
  value: number;

  @ApiProperty({ example: '%' })
  unit: string;

  @ApiProperty({ example: '>= 8%' })
  threshold: string;

  @ApiProperty({ example: 'pass', enum: ['pass', 'warning', 'fail', 'info'] })
  status: string;

  @ApiProperty({ example: 'Equity/Assets: 10.8%. Well-capitalized: 8%+.' })
  description: string;

  @ApiPropertyOptional({ example: 9.2 })
  sectorMedian: number | null;

  @ApiPropertyOptional({ example: 'Top quartile' })
  percentileRank: string | null;
}

export class DurationGapResponseDto {
  @ApiProperty({ example: 5.23 })
  assetDuration: number;

  @ApiProperty({ example: 1.45 })
  liabilityDuration: number;

  @ApiProperty({ example: 3.78 })
  durationGap: number;

  @ApiProperty({
    example: 'asset-sensitive',
    enum: ['asset-sensitive', 'liability-sensitive', 'neutral'],
  })
  riskProfile: string;
}

export class NIISensitivityResponseDto {
  @ApiProperty({ example: 4.8 })
  baseNII: number;

  @ApiProperty({
    example: 'moderate',
    enum: ['low', 'moderate', 'high', 'critical'],
  })
  riskRating: string;
}

export class LCRResponseDto {
  @ApiProperty({ example: 118.5 })
  lcr: number;

  @ApiProperty({
    example: 'compliant',
    enum: ['compliant', 'warning', 'breach'],
  })
  status: string;
}

export class BenchmarkDto {
  @ApiProperty({ example: 'capital_adequacy' })
  metric!: string;

  @ApiProperty({ example: 10.81 })
  value!: number;

  @ApiProperty({ example: 9.2 })
  peerMedian!: number;

  @ApiProperty({ example: 75 })
  percentile!: number;

  @ApiPropertyOptional({ example: 'above-median' })
  status?: string;
}

export class AnalysisSummaryDto {
  @ApiProperty({ example: 42 })
  riskScore!: number;

  @ApiProperty({ example: 10.81 })
  capitalRatio!: number;

  @ApiProperty({ example: 118.5 })
  liquidityCoverageRatio!: number;

  @ApiProperty({ example: 3.78 })
  durationGap!: number;

  @ApiPropertyOptional({ example: 4.8 })
  niiSensitivity?: number;

  @ApiPropertyOptional({ example: -2.1 })
  eveSensitivity?: number;

  @ApiPropertyOptional({ example: 'Overall risk profile is moderate.' })
  narrative?: string;
}

export class RegulatoryRatioDto {
  @ApiProperty({ example: 'cap_adequacy' })
  id!: string;

  @ApiProperty({ example: 'Capital Adequacy' })
  name!: string;

  @ApiProperty({ example: 10.81 })
  value!: number;

  @ApiProperty({ example: 8 })
  threshold!: number;

  @ApiProperty({
    description: "'PASS' | 'WARNING' | 'FAIL'",
    example: 'PASS',
  })
  status!: string;

  @ApiPropertyOptional({ example: 'Equity/Assets ratio' })
  description?: string;
}

export class AnalysisResultResponseDto {
  @ApiProperty({
    description: 'Unique analysis ID for retrieval',
    example: 'clxyz123abc',
  })
  analysisId: string;

  @ApiProperty({
    description: 'COSSEC regulatory ratios (12 ratios)',
    type: [CossecRatioResponseDto],
  })
  ratios: CossecRatioResponseDto[];

  @ApiProperty({
    description: 'Duration gap analysis',
    type: DurationGapResponseDto,
  })
  durationGap: DurationGapResponseDto;

  @ApiProperty({
    description: 'NII sensitivity analysis',
    type: NIISensitivityResponseDto,
  })
  niiSensitivity: NIISensitivityResponseDto;

  @ApiProperty({
    description: 'Liquidity coverage ratio',
    type: LCRResponseDto,
  })
  lcr: LCRResponseDto;

  @ApiProperty({ description: 'Exam readiness score (0-100)', example: 75 })
  examReadinessScore: number;

  @ApiProperty({
    description: 'AI-generated recommendations',
    example: ['Extend liability duration to narrow gap'],
  })
  recommendations: string[];

  @ApiProperty({
    description: 'PR cooperativa sector benchmarks used',
    type: [BenchmarkDto],
  })
  benchmarks: BenchmarkDto[];

  @ApiProperty({
    description: 'COSSEC compliance status',
    example: 'conditional',
    enum: ['compliant', 'conditional', 'non-compliant'],
  })
  overallStatus: string;

  @ApiProperty({
    description: 'Balance sheet summary',
    type: AnalysisSummaryDto,
  })
  summary: AnalysisSummaryDto;
}

export class BenchmarkResponseDto {
  @ApiProperty({ example: '2025-Q3' })
  lastUpdated: string;

  @ApiProperty({
    example: 'COSSEC Informe Sectorial Q3 2025 / NCUA Call Reports',
  })
  source: string;

  @ApiProperty({ example: 185 })
  medianAssets: number;

  @ApiProperty({
    description: 'Ratio benchmarks with median, p25, p75',
    type: [RegulatoryRatioDto],
  })
  ratios: RegulatoryRatioDto[];
}

export class FrameworkResponseDto {
  @ApiProperty({ example: 'cossec' })
  id: string;

  @ApiProperty({ example: 'COSSEC (PR Cooperativas)' })
  name: string;

  @ApiProperty({
    example:
      'Corporacion para la Supervision y Seguro de Cooperativas de Puerto Rico',
  })
  description: string;

  @ApiProperty({ example: 12 })
  ratioCount: number;

  @ApiProperty({ example: ['cooperativa', 'credit_union'] })
  supportedInstitutionTypes: string[];
}
