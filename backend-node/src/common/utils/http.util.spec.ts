import { extractClientIP, parseUserAgent } from './http.util';

describe('http.util', () => {
  describe('extractClientIP', () => {
    it('extracts IP from x-forwarded-for header', () => {
      const req = {
        headers: { 'x-forwarded-for': '203.0.113.50, 70.41.3.18' },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      expect(extractClientIP(req)).toBe('203.0.113.50');
    });

    it('extracts IP from cf-connecting-ip header', () => {
      const req = {
        headers: { 'cf-connecting-ip': '1.2.3.4' },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      expect(extractClientIP(req)).toBe('1.2.3.4');
    });

    it('extracts IP from true-client-ip header', () => {
      const req = {
        headers: { 'true-client-ip': '5.6.7.8' },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      expect(extractClientIP(req)).toBe('5.6.7.8');
    });

    it('extracts IP from x-real-ip header', () => {
      const req = {
        headers: { 'x-real-ip': '9.10.11.12' },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      expect(extractClientIP(req)).toBe('9.10.11.12');
    });

    it('falls back to req.ip', () => {
      const req = {
        headers: {},
        ip: '10.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      expect(extractClientIP(req)).toBe('10.0.0.1');
    });

    it('falls back to socket.remoteAddress when req.ip is undefined', () => {
      const req = {
        headers: {},
        ip: undefined,
        socket: { remoteAddress: '192.168.1.1' },
      } as any;
      expect(extractClientIP(req)).toBe('192.168.1.1');
    });

    it('returns "unknown" when no IP source available', () => {
      const req = {
        headers: {},
        ip: undefined,
        socket: {},
      } as any;
      expect(extractClientIP(req)).toBe('unknown');
    });

    it('trims whitespace from x-forwarded-for first entry', () => {
      const req = {
        headers: { 'x-forwarded-for': '  10.0.0.5  , 10.0.0.6' },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      expect(extractClientIP(req)).toBe('10.0.0.5');
    });

    it('handles x-forwarded-for as array (non-string)', () => {
      const req = {
        headers: { 'x-forwarded-for': ['1.1.1.1', '2.2.2.2'] },
        ip: '10.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      // When it's an array, typeof is not 'string', so falls through
      expect(extractClientIP(req)).toBe('10.0.0.1');
    });

    it('ignores empty x-forwarded-for string', () => {
      const req = {
        headers: { 'x-forwarded-for': '' },
        ip: '10.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      expect(extractClientIP(req)).toBe('10.0.0.1');
    });

    it('ignores empty cf-connecting-ip string', () => {
      const req = {
        headers: { 'cf-connecting-ip': '' },
        ip: '10.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      expect(extractClientIP(req)).toBe('10.0.0.1');
    });

    it('prioritizes x-forwarded-for over cf-connecting-ip', () => {
      const req = {
        headers: {
          'x-forwarded-for': '1.1.1.1',
          'cf-connecting-ip': '2.2.2.2',
        },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      expect(extractClientIP(req)).toBe('1.1.1.1');
    });

    it('prioritizes cf-connecting-ip over true-client-ip', () => {
      const req = {
        headers: {
          'cf-connecting-ip': '2.2.2.2',
          'true-client-ip': '3.3.3.3',
        },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      expect(extractClientIP(req)).toBe('2.2.2.2');
    });

    it('prioritizes true-client-ip over x-real-ip', () => {
      const req = {
        headers: {
          'true-client-ip': '3.3.3.3',
          'x-real-ip': '4.4.4.4',
        },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      expect(extractClientIP(req)).toBe('3.3.3.3');
    });

    it('handles null socket', () => {
      const req = {
        headers: {},
        ip: undefined,
        socket: null,
      } as any;
      expect(extractClientIP(req)).toBe('unknown');
    });
  });

  describe('parseUserAgent', () => {
    it('detects Chrome on macOS', () => {
      const ua =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0';
      const info = parseUserAgent(ua);
      expect(info.browser).toBe('Chrome');
      expect(info.os).toBe('macOS');
      expect(info.isBot).toBe(false);
      expect(info.isMobile).toBe(false);
    });

    it('detects Firefox', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0';
      const info = parseUserAgent(ua);
      expect(info.browser).toBe('Firefox');
      expect(info.os).toBe('Windows');
    });

    it('detects Edge', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0.0.0';
      const info = parseUserAgent(ua);
      expect(info.browser).toBe('Edge');
    });

    it('detects Safari (without Chrome)', () => {
      const ua =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
      const info = parseUserAgent(ua);
      expect(info.browser).toBe('Safari');
      expect(info.os).toBe('macOS');
    });

    it('detects Opera', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 OPR/105.0.0.0';
      const info = parseUserAgent(ua);
      expect(info.browser).toBe('Opera');
    });

    it('detects bots', () => {
      const info = parseUserAgent(
        'Googlebot/2.1 (+http://www.google.com/bot.html)',
      );
      expect(info.isBot).toBe(true);
    });

    it('detects curl as bot', () => {
      const info = parseUserAgent('curl/7.88.1');
      expect(info.isBot).toBe(true);
    });

    it('detects wget as bot', () => {
      const info = parseUserAgent('Wget/1.21.3');
      expect(info.isBot).toBe(true);
    });

    it('detects python as bot', () => {
      const info = parseUserAgent('python-requests/2.28.0');
      expect(info.isBot).toBe(true);
    });

    it('detects mobile Android', () => {
      const ua =
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
      const info = parseUserAgent(ua);
      expect(info.isMobile).toBe(true);
      expect(info.os).toBe('Android');
    });

    it('detects mobile iPhone', () => {
      const ua =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
      const info = parseUserAgent(ua);
      expect(info.isMobile).toBe(true);
      expect(info.os).toBe('iOS');
    });

    it('detects iPad as mobile and iOS', () => {
      const ua =
        'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
      const info = parseUserAgent(ua);
      expect(info.isMobile).toBe(true);
      expect(info.os).toBe('iOS');
    });

    it('detects Linux OS', () => {
      const ua =
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0';
      const info = parseUserAgent(ua);
      expect(info.os).toBe('Linux');
    });

    it('handles undefined user agent', () => {
      const info = parseUserAgent(undefined);
      expect(info.raw).toBe('');
      expect(info.browser).toBe('Unknown');
      expect(info.os).toBe('Unknown');
      expect(info.isBot).toBe(false);
      expect(info.isMobile).toBe(false);
    });

    it('handles empty string user agent', () => {
      const info = parseUserAgent('');
      expect(info.raw).toBe('');
      expect(info.browser).toBe('Unknown');
      expect(info.os).toBe('Unknown');
    });

    it('returns raw UA string', () => {
      const ua = 'CustomAgent/1.0';
      expect(parseUserAgent(ua).raw).toBe(ua);
    });

    it('returns Unknown browser for unrecognized UA', () => {
      const info = parseUserAgent('SomeRandomBrowser/1.0');
      expect(info.browser).toBe('Unknown');
    });

    it('returns Unknown OS for unrecognized platform', () => {
      const info = parseUserAgent('SomeApp/1.0 (FreeBSD)');
      expect(info.os).toBe('Unknown');
    });
  });
});
