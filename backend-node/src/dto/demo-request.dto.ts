import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class DemoRequestDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  institutionName?: string;

  @IsOptional()
  @IsIn([
    'cooperativa',
    'credit_union',
    'community_bank',
    'cpa_consultant',
    'bank',
    'family_office',
    'other',
  ])
  institutionType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  totalAssets?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
