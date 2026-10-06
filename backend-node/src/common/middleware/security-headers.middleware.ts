import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Adds strict security headers to every response.
 * Covers HSTS, content sniffing, framing, XSS, and referrer policy.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    // HTTPS enforcement (1 year, include subdomains, preload-ready)
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );

    // Prevent MIME sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Block framing (clickjacking protection)
    res.setHeader('X-Frame-Options', 'DENY');

    // Legacy XSS filter (still respected by some browsers)
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer policy — send origin only on cross-origin
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions policy — restrict sensitive browser APIs
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(self)',
    );

    // Prevent the page from being used as a DNS prefetch source
    res.setHeader('X-DNS-Prefetch-Control', 'off');

    next();
  }
}
