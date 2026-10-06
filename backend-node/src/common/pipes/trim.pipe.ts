import { PipeTransform, Injectable } from '@nestjs/common';

/**
 * Auto-trim whitespace from all string inputs.
 * Recursively processes objects and arrays to trim every string field.
 * Prevents issues with leading/trailing spaces in user-submitted data.
 */
@Injectable()
export class TrimPipe implements PipeTransform {
  transform(value: any) {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'object' && value !== null) {
      return this.trimObject(value);
    }
    return value;
  }

  private trimObject(obj: any): any {
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
