import { PipeTransform, Injectable } from '@nestjs/common';

/**
 * Parse a string to integer, returning a default value if parsing fails.
 * Unlike the built-in ParseIntPipe, this never throws — it silently falls
 * back to the provided default.
 *
 * @example
 * @Get()
 * findAll(@Query('page', new ParseIntWithDefaultPipe(1)) page: number) { ... }
 */
@Injectable()
export class ParseIntWithDefaultPipe implements PipeTransform<string, number> {
  constructor(
    private readonly defaultValue: number,
    private readonly options?: { min?: number; max?: number },
  ) {}

  transform(value: string): number {
    const parsed = parseInt(value, 10);
    let result = Number.isFinite(parsed) ? parsed : this.defaultValue;

    if (this.options?.min !== undefined) {
      result = Math.max(result, this.options.min);
    }
    if (this.options?.max !== undefined) {
      result = Math.min(result, this.options.max);
    }

    return result;
  }
}
