import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

/**
 * Password strength validator.
 * Enforces minimum 8 characters, at least one uppercase letter,
 * one lowercase letter, one digit, and one special character.
 */
@ValidatorConstraint({ name: 'passwordStrength', async: false })
export class PasswordStrengthConstraint implements ValidatorConstraintInterface {
  validate(password: string, _args: ValidationArguments): boolean {
    if (!password || typeof password !== 'string') return false;
    if (password.length < 8) return false;
    if (!/[A-Z]/.test(password)) return false;
    if (!/[a-z]/.test(password)) return false;
    if (!/[0-9]/.test(password)) return false;
    if (!/[!@#$%^&*()_+=[\]{};':"\\|,.<>/?-]/.test(password)) return false;
    return true;
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'Password must be at least 8 characters with uppercase, lowercase, number, and special character';
  }
}

/**
 * Decorator to apply password strength validation to a DTO field.
 * @example
 * ```typescript
 * @IsStrongPassword()
 * password: string;
 * ```
 */
export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: PasswordStrengthConstraint,
    });
  };
}
