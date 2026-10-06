import { Injectable, NestMiddleware, Logger } from '@nestjs/common';

/**
 * API version header middleware.
 * Sets X-API-Version on every response and reads Accept-Version from requests.
 * Enables future version routing without breaking existing clients.
 */
const CURRENT_API_VERSION = '1.0';
const SUPPORTED_VERSIONS = ['1.0'];

@Injectable()
export class ApiVersionMiddleware implements NestMiddleware {
  private readonly logger = new Logger('ApiVersion');

  use(req: any, res: any, next: () => void) {
    const requestedVersion =
      req.headers['accept-version'] || CURRENT_API_VERSION;

    // Warn on unsupported version requests (forward-compatible)
    if (!SUPPORTED_VERSIONS.includes(requestedVersion)) {
      this.logger.warn(
        `Client requested unsupported API version: ${requestedVersion}`,
      );
    }

    // Always respond with the version being served
    res.setHeader('X-API-Version', CURRENT_API_VERSION);
    res.setHeader('X-Supported-Versions', SUPPORTED_VERSIONS.join(', '));

    next();
  }
}
