import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

/**
 * Validates that a start date is before an end date.
 * Applied to the end date field, referencing the start date field.
 *
 * @example
 * class DateRangeDto {
 *   @IsDateString()
 *   startDate: string;
 *
 *   @IsDateString()
 *   @IsAfterDate('startDate')
 *   endDate: string;
 * }
 */
@ValidatorConstraint({ name: 'isAfterDate', async: false })
export class IsAfterDateConstraint implements ValidatorConstraintInterface {
  validate(endDate: string, args: ValidationArguments): boolean {
    const [startDateField] = args.constraints;
    const startDate = (args.object as any)[startDateField];

    if (!startDate || !endDate) return true; // Let @IsDateString handle missing

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) return true;

    return end > start;
  }

  defaultMessage(args: ValidationArguments): string {
    const [startDateField] = args.constraints;
    return `${args.property} must be after ${startDateField}`;
  }
}

export function IsAfterDate(
  startDateField: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [startDateField],
      validator: IsAfterDateConstraint,
    });
  };
}

/**
 * Validates that a date range doesn't exceed a maximum span.
 */
@ValidatorConstraint({ name: 'maxDateSpan', async: false })
export class MaxDateSpanConstraint implements ValidatorConstraintInterface {
  validate(endDate: string, args: ValidationArguments): boolean {
    const [startDateField, maxDays] = args.constraints;
    const startDate = (args.object as any)[startDateField];

    if (!startDate || !endDate) return true;

    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffMs = end.getTime() - start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    return diffDays <= maxDays;
  }

  defaultMessage(args: ValidationArguments): string {
    const [, maxDays] = args.constraints;
    return `Date range must not exceed ${maxDays} days`;
  }
}

export function MaxDateSpan(
  startDateField: string,
  maxDays: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [startDateField, maxDays],
      validator: MaxDateSpanConstraint,
    });
  };
}
