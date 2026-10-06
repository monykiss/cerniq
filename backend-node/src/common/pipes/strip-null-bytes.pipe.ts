import { PipeTransform, Injectable } from '@nestjs/common';

/**
 * Strip null bytes from all string inputs.
 * Null bytes can cause issues with PostgreSQL, C-based libraries,
 * and can be used in null byte injection attacks.
 */
@Injectable()
export class StripNullBytesPipe implements PipeTransform {
  transform(value: any) {
    if (typeof value === 'string') {
      return value.replace(/\0/g, '');
    }
    if (typeof value === 'object' && value !== null) {
      return this.processObject(value);
    }
    return value;
  }

  private processObject(obj: any): any {
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
