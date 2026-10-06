import {
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  IsIn,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInstitutionDto {
  @ApiProperty({
    description: 'Institution name',
    example: 'Cooperativa de Ahorro y Credito Ejemplo Sur',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Institution type',
    enum: ['bank', 'credit_union', 'family_office', 'cooperativa'],
    example: 'cooperativa',
  })
  @IsString()
  @IsIn(['bank', 'credit_union', 'family_office', 'cooperativa'])
  type: string;

  @ApiProperty({
    description: 'Total assets in base currency',
    example: 250000000,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  totalAssets: number;

  @ApiPropertyOptional({
    description: 'ISO 4217 currency code',
    example: 'USD',
    default: 'USD',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({
    description: 'Balance sheet reporting date (ISO 8601)',
    example: '2026-03-31',
  })
  @IsDateString()
  reportingDate: string;

  @ApiProperty({
    description: 'Workspace UUID to associate the institution with',
  })
  @IsString()
  workspaceId: string;

  @ApiPropertyOptional({
    description: 'Primary regulatory framework',
    enum: ['COSSEC', 'NCUA'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['COSSEC', 'NCUA'])
  primaryRegulator?: string;

  @ApiPropertyOptional({
    description: 'Preferred report/UI language',
    enum: ['en', 'es', 'both'],
    default: 'es',
  })
  @IsOptional()
  @IsString()
  @IsIn(['en', 'es', 'both'])
  preferredLanguage?: string;
}
