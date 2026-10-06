import { PipeTransform, Injectable } from '@nestjs/common';

/**
 * Normalize email fields to lowercase.
 * Ensures consistent email comparison and storage by converting
 * all email-like string fields to lowercase before processing.
 */
@Injectable()
export class LowercaseEmailPipe implements PipeTransform {
  private readonly emailFields = [
    'email',
    'userEmail',
    'contactEmail',
    'workEmail',
  ];

  transform(value: any) {
    if (typeof value === 'string') {
      return this.isEmail(value) ? value.toLowerCase() : value;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return this.processObject(value);
    }
    return value;
  }

  private processObject(obj: any): any {
    const result: any = { ...obj };
    for (const [key, val] of Object.entries(result)) {
      if (typeof val === 'string' && this.emailFields.includes(key)) {
        result[key] = val.toLowerCase().trim();
      }
    }
    return result;
  }

  private isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }
}
