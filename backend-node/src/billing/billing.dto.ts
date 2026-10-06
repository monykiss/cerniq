import { IsString, IsOptional, IsIn, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckoutRequestDto {
  @ApiProperty({
    description: 'Subscription tier',
    enum: ['one_time', 'monthly', 'annual', 'partner'],
    example: 'monthly',
  })
  @IsIn(['one_time', 'monthly', 'annual', 'partner'])
  tier: 'one_time' | 'monthly' | 'annual' | 'partner';

  @ApiPropertyOptional({
    description: 'Customer email for the checkout session',
    example: 'cfo@cooperativa.example',
  })
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiPropertyOptional({
    description: 'Customer display name',
    example: 'Juan Rodriguez',
  })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({
    description: 'Name of the financial institution',
    example: 'Cooperativa de Ahorro y Credito',
  })
  @IsOptional()
  @IsString()
  institutionName?: string;

  @ApiPropertyOptional({ description: 'Lead ID for attribution tracking' })
  @IsOptional()
  @IsString()
  leadId?: string;

  @ApiPropertyOptional({ description: 'Promotional/discount code' })
  @IsOptional()
  @IsString()
  promoCode?: string;

  @ApiProperty({
    description: 'URL to redirect after successful payment',
    example: 'https://cerniq.io/login?billing=success&returnUrl=%2Fdashboard',
  })
  @IsString()
  successUrl: string;

  @ApiProperty({
    description: 'URL to redirect if payment is cancelled',
    example: 'https://cerniq.io/pricing',
  })
  @IsString()
  cancelUrl: string;
}
