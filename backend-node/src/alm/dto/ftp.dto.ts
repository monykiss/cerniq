import { IsString, IsOptional, IsNumber } from 'class-validator';

export class CustomFTPDto {
  @IsOptional()
  @IsString()
  curveId?: string;

  @IsOptional()
  @IsNumber()
  spreadAdjBps?: number; // basis point adjustment to FTP rates
}
