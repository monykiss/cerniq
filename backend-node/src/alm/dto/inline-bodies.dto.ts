import { IsOptional, IsString, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class YieldCurveOverrideDto {
  @ApiPropertyOptional() @IsOptional() @IsString() curveId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() spreadAdjBps?: number;
}

export class ForceFailDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

export class UpdateMemberRoleDto {
  @IsString() role!: string;
}
