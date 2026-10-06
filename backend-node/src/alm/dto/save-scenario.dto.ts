import { IsString, IsOptional, IsObject, IsArray } from 'class-validator';

export class SaveScenarioDto {
  @IsString()
  institutionId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  scenarioType: string; // custom | parallel | steepening | flattening | pr_specific | hurricane | recession

  @IsObject()
  parameters: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  results?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class CompareScenarioDto {
  @IsArray()
  @IsString({ each: true })
  scenarioIds: string[]; // 2-4 scenario IDs to compare
}
