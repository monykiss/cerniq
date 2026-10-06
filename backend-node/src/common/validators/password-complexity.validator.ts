import { PipeTransform, BadRequestException } from '@nestjs/common';

/**
 * Validates password complexity for enterprise security requirements.
 * Rules: >= 10 chars, at least one uppercase, one lowercase, one digit, one special char.
 */
export class PasswordComplexityPipe implements PipeTransform {
  private static readonly MIN_LENGTH = 10;
  private static readonly RULES: Array<{ regex: RegExp; message: string }> = [
    { regex: /[A-Z]/, message: 'at least one uppercase letter' },
    { regex: /[a-z]/, message: 'at least one lowercase letter' },
    { regex: /[0-9]/, message: 'at least one digit' },
    { regex: /[^A-Za-z0-9]/, message: 'at least one special character' },
  ];

  transform(value: string): string {
    if (!value || typeof value !== 'string') {
      throw new BadRequestException('Password is required');
    }

    const failures: string[] = [];

    if (value.length < PasswordComplexityPipe.MIN_LENGTH) {
      failures.push(`at least ${PasswordComplexityPipe.MIN_LENGTH} characters`);
    }

    for (const rule of PasswordComplexityPipe.RULES) {
      if (!rule.regex.test(value)) {
        failures.push(rule.message);
      }
    }

    if (failures.length > 0) {
      throw new BadRequestException(
        `Password must contain: ${failures.join(', ')}`,
      );
    }

    return value;
  }
}
