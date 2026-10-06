/**
 * HTTP utilities — client IP extraction, user agent parsing.
 * Helpers for request introspection in middleware and guards.
 */

import { Request } from 'express';

/**
 * Extract the real client IP from a request,
 * respecting common reverse-proxy headers.
 */
export function extractClientIP(req: Request): string {
  // X-Forwarded-For can be a comma-separated list; first is the client
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  // Cloudflare
  const cfIP = req.headers['cf-connecting-ip'];
  if (typeof cfIP === 'string' && cfIP) return cfIP;

  // True-Client-IP (Akamai, etc.)
  const trueClient = req.headers['true-client-ip'];
  if (typeof trueClient === 'string' && trueClient) return trueClient;

  // X-Real-IP (nginx)
  const realIP = req.headers['x-real-ip'];
  if (typeof realIP === 'string' && realIP) return realIP;

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Parsed user agent info.
 */
export interface UserAgentInfo {
  raw: string;
  isBot: boolean;
  isMobile: boolean;
  browser: string;
  os: string;
}

/**
 * Parse a user agent string into structured info.
 * Lightweight — for full parsing, use a dedicated library.
 */
export function parseUserAgent(ua: string | undefined): UserAgentInfo {
  const raw = ua || '';
  const lower = raw.toLowerCase();

  const isBot = /bot|crawl|spider|slurp|curl|wget|python|http/i.test(raw);
  const isMobile = /mobile|android|iphone|ipad|ipod/i.test(raw);

  let browser = 'Unknown';
  if (lower.includes('firefox')) browser = 'Firefox';
  else if (lower.includes('edg/')) browser = 'Edge';
  else if (lower.includes('chrome')) browser = 'Chrome';
  else if (lower.includes('safari')) browser = 'Safari';
  else if (lower.includes('opera') || lower.includes('opr')) browser = 'Opera';

  let os = 'Unknown';
  if (lower.includes('android')) os = 'Android';
  else if (lower.includes('iphone') || lower.includes('ipad')) os = 'iOS';
  else if (lower.includes('windows')) os = 'Windows';
  else if (lower.includes('mac os') || lower.includes('macos')) os = 'macOS';
  else if (lower.includes('linux')) os = 'Linux';

  return { raw, isBot, isMobile, browser, os };
}
