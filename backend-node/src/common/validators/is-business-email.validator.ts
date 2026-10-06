import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

const FREE_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'mail.com',
  'protonmail.com',
  'zoho.com',
  'yandex.com',
  'gmx.com',
  'live.com',
];

/**
 * Validates that an email belongs to a business domain (not a free provider).
 * Enterprise requirement: certain operations require corporate email addresses.
 */
@ValidatorConstraint({ name: 'isBusinessEmail', async: false })
export class IsBusinessEmailConstraint implements ValidatorConstraintInterface {
  validate(email: string, _args: ValidationArguments): boolean {
    if (!email || typeof email !== 'string') return false;
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return false;
    return !FREE_EMAIL_DOMAINS.includes(domain);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'A business email address is required (free email providers are not accepted)';
  }
}

/**
 * Decorator to validate that a field contains a business email.
 *
 * @example
 * @IsBusinessEmail()
 * corporateEmail: string;
 */
export function IsBusinessEmail(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsBusinessEmailConstraint,
    });
  };
}
