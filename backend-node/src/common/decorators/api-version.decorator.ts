import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for API version requirements.
 */
export const API_VERSION_KEY = 'api_version';

/**
 * Mark a controller or route handler with the minimum API version it supports.
 * Used by version-checking middleware/guards to enforce version compatibility.
 *
 * @example
 * @ApiVersion('2')
 * @Controller('reports')
 * export class ReportsV2Controller { ... }
 *
 * @example
 * @ApiVersion('1', '2')
 * @Get('summary')
 * getSummary() { ... }
 */
export const ApiVersion = (...versions: string[]) =>
  SetMetadata(API_VERSION_KEY, versions);

/**
 * Mark a route as deprecated — still functional but will be removed.
 * Adds metadata that middleware can use to set Deprecation headers.
 */
export const DEPRECATED_VERSION_KEY = 'deprecated_api_version';

export const DeprecatedInVersion = (version: string, sunset?: string) =>
  SetMetadata(DEPRECATED_VERSION_KEY, { version, sunset });
