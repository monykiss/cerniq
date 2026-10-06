import {
  isValidUrl,
  normalizeUrl,
  isSafeRedirect,
  extractDomain,
  buildUrl,
} from './url.util';

describe('url.util', () => {
  describe('isValidUrl', () => {
    it('accepts valid HTTPS URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
    });

    it('rejects invalid strings', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
    });
  });

  describe('normalizeUrl', () => {
    it('removes default port 443 for HTTPS', () => {
      expect(normalizeUrl('https://example.com:443/path')).toBe(
        'https://example.com/path',
      );
    });

    it('sorts query parameters alphabetically', () => {
      const result = normalizeUrl('https://example.com?z=1&a=2');
      expect(result).toBe('https://example.com/?a=2&z=1');
    });
  });

  describe('isSafeRedirect', () => {
    it('allows relative URLs', () => {
      expect(isSafeRedirect('/dashboard', ['example.com'])).toBe(true);
    });

    it('blocks protocol-relative URLs', () => {
      expect(isSafeRedirect('//evil.com', ['example.com'])).toBe(false);
    });

    it('allows URLs on allowed hosts', () => {
      expect(
        isSafeRedirect('https://app.example.com/page', ['example.com']),
      ).toBe(true);
    });

    it('blocks URLs on disallowed hosts', () => {
      expect(isSafeRedirect('https://evil.com/page', ['example.com'])).toBe(
        false,
      );
    });
  });

  describe('extractDomain', () => {
    it('extracts hostname from URL', () => {
      expect(extractDomain('https://www.example.com:8080/path')).toBe(
        'www.example.com',
      );
    });

    it('returns null for invalid input', () => {
      expect(extractDomain('not-a-url')).toBeNull();
    });
  });

  describe('buildUrl', () => {
    it('builds URL with query parameters', () => {
      const result = buildUrl('https://api.example.com/search', {
        q: 'test',
        page: 1,
      });
      expect(result).toContain('q=test');
      expect(result).toContain('page=1');
    });

    it('skips undefined values', () => {
      const result = buildUrl('https://api.example.com/search', {
        q: 'test',
        filter: undefined,
      });
      expect(result).toContain('q=test');
      expect(result).not.toContain('filter');
    });

    it('handles boolean values', () => {
      const result = buildUrl('https://api.example.com/search', {
        active: true,
      });
      expect(result).toContain('active=true');
    });
  });

  // Coverage: line 31 — normalizeUrl removes default port 80
  describe('normalizeUrl edge cases', () => {
    it('removes default port 80 for HTTP', () => {
      const result = normalizeUrl('http://example.com:80/path');
      expect(result).toBe('http://example.com/path');
    });

    it('returns input for invalid URL', () => {
      expect(normalizeUrl('not-a-url')).toBe('not-a-url');
    });

    it('removes trailing slash from non-root paths', () => {
      const result = normalizeUrl('https://example.com/path/');
      expect(result).toBe('https://example.com/path');
    });

    it('preserves trailing slash for root path', () => {
      const result = normalizeUrl('https://example.com/');
      expect(result).toBe('https://example.com/');
    });
  });

  // Coverage: line 44 — isSafeRedirect with non-http protocol
  describe('isSafeRedirect edge cases', () => {
    it('blocks javascript: protocol', () => {
      expect(isSafeRedirect('javascript:alert(1)', ['example.com'])).toBe(
        false,
      );
    });

    it('blocks data: protocol', () => {
      expect(
        isSafeRedirect('data:text/html,<h1>hi</h1>', ['example.com']),
      ).toBe(false);
    });

    it('returns false for invalid URL string', () => {
      expect(isSafeRedirect('not a url at all', ['example.com'])).toBe(false);
    });
  });

  // Coverage: line 71 — extractDomain
  describe('extractDomain edge cases', () => {
    it('extracts domain from HTTP URL', () => {
      expect(extractDomain('http://sub.domain.com:8080/path')).toBe(
        'sub.domain.com',
      );
    });
  });
});
