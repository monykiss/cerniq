import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

/**
 * UUID validation and parsing pipe.
 * Validates that a parameter is a valid UUID v4 format.
 * Optionally normalizes to lowercase.
 *
 * @example
 * @Get(':id')
 * findOne(@Param('id', ParseUUIDSafePipe) id: string) { ... }
 */
@Injectable()
export class ParseUUIDSafePipe implements PipeTransform<string, string> {
  private static readonly UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private static readonly UUID_ANY_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  constructor(
    private readonly options?: {
      version?: 4 | 'any';
      optional?: boolean;
      errorMessage?: string;
    },
  ) {}

  transform(value: string): string {
    if (!value && this.options?.optional) {
      return value;
    }

    if (!value) {
      throw new BadRequestException(
        this.options?.errorMessage || 'UUID value is required',
      );
    }

    const normalized = value.trim().toLowerCase();

    if (!ParseUUIDSafePipe.UUID_ANY_REGEX.test(normalized)) {
      throw new BadRequestException(
        this.options?.errorMessage ||
          `Invalid UUID format: "${value}". Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`,
      );
    }

    return normalized;
  }
}
