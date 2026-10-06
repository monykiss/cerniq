import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    description: 'User email address',
    example: 'analyst@creditunion.example',
  })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Password (min 8 characters)', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @ApiPropertyOptional({ description: 'Display name', example: 'Maria Lopez' })
  @IsOptional()
  @IsString()
  name?: string;
}

export class LoginDto {
  @ApiProperty({
    description: 'Registered email address',
    example: 'analyst@creditunion.example',
  })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Account password' })
  @IsString()
  password: string;
}

export class PasswordResetRequestDto {
  @ApiProperty({
    description: 'Email address to send reset link',
    example: 'analyst@creditunion.example',
  })
  @IsEmail()
  email: string;
}

export class PasswordResetConfirmDto {
  @ApiProperty({ description: 'Password reset token from email' })
  @IsString()
  token: string;

  @ApiProperty({ description: 'New password (min 8 characters)', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current account password' })
  @IsString()
  currentPassword: string;

  @ApiProperty({ description: 'New password (min 8 characters)', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  newPassword: string;
}

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description: 'Refresh token (also read from cookie if omitted)',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class MagicLinkRequestDto {
  @ApiProperty({
    description: 'Email address to send magic link',
    example: 'cfo@cooperativa.example',
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: 'Optional in-app return path after sign-in completes',
    example: '/portal',
  })
  @IsOptional()
  @IsString()
  returnUrl?: string;
}
