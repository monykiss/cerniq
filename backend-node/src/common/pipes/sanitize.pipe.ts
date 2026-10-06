import { PipeTransform, Injectable } from '@nestjs/common';

/**
 * Sanitize string inputs to prevent XSS.
 * Strips HTML tags and dangerous characters from string fields.
 * Applied globally via ValidationPipe transform.
 */
@Injectable()
export class SanitizePipe implements PipeTransform {
  transform(value: any) {
    if (typeof value === 'string') {
      return this.sanitize(value);
    }
    if (typeof value === 'object' && value !== null) {
      return this.sanitizeObject(value);
    }
    return value;
  }

  private sanitize(str: string): string {
    return str
      .replace(/[<>]/g, '') // Strip angle brackets
      .replace(/javascript:/gi, '') // Strip javascript: URLs
      .replace(/on\w+\s*=/gi, '') // Strip event handlers
      .trim();
  }

  private sanitizeObject(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map((item: any) => this.transform(item));
    }
    const result: any = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = this.transform(val);
    }
    return result;
  }
}
