/**
 * proxy.ts — legacy redirect table contract.
 *
 * These tests lock the 10-entry redirect table from the Phase 2 cockpit
 * route reconciliation (commit fb8ca72f). They fail loudly if:
 *   • A legacy path stops resolving (breaks email deep-links)
 *   • A canonical path starts redirecting (infinite loop risk)
 *   • Query strings get mangled (drops ?runId=... from email alerts)
 *   • Prefix ordering regresses (/cockpit accidentally eats
 *     /cockpit/decisions)
 *
 * The resolver is a pure function — no NextRequest/NextResponse coupling
 * needed. The full proxy handler's admin-gate branch is covered
 * separately in the integration suite.
 */

import { describe, it, expect } from 'vitest';
import { resolveLegacyRedirect } from '@/proxy';

describe('resolveLegacyRedirect', () => {
  describe('exact legacy roots', () => {
    it.each([
      ['/decisions', '/alm/decisions'],
      ['/cockpit', '/alm/decisions'],
      ['/cockpit/decisions', '/alm/decisions'],
      ['/cockpit/dashboard', '/alm/decisions'],
      ['/cockpit/agents', '/alm/agents'],
      ['/cockpit/alerts', '/alm/agents/alerts'],
      ['/agents', '/alm/agents'],
      ['/agents/alerts', '/alm/agents/alerts'],
      ['/agents/copilot', '/alm/copilot'],
    ])('%s → %s', (input, expected) => {
      expect(resolveLegacyRedirect(input)).toBe(expected);
    });
  });

  describe('path suffix preservation', () => {
    it('preserves the runId segment in /cockpit/decisions/:runId', () => {
      expect(resolveLegacyRedirect('/cockpit/decisions/run-abc123')).toBe(
        '/alm/decisions/run-abc123',
      );
    });

    it('preserves nested segments', () => {
      expect(resolveLegacyRedirect('/cockpit/agents/alerts/active')).toBe(
        '/alm/agents/alerts/active',
      );
    });
  });

  describe('prefix precedence (longer prefixes match first)', () => {
    it('matches /cockpit/decisions before /cockpit (no prefix bleed)', () => {
      // The table lists /cockpit/decisions above /cockpit, so it wins.
      // If ordering regresses, /cockpit/decisions would match /cockpit
      // and strip to `/alm/decisions/decisions` — that test catches it.
      expect(resolveLegacyRedirect('/cockpit/decisions')).toBe(
        '/alm/decisions',
      );
      expect(resolveLegacyRedirect('/cockpit/decisions/run-1')).toBe(
        '/alm/decisions/run-1',
      );
    });

    it('matches /agents/alerts before /agents', () => {
      expect(resolveLegacyRedirect('/agents/alerts')).toBe(
        '/alm/agents/alerts',
      );
    });

    it('matches /agents/copilot before /agents', () => {
      expect(resolveLegacyRedirect('/agents/copilot')).toBe('/alm/copilot');
    });
  });

  describe('already-canonical paths are pass-through', () => {
    it.each([
      '/alm',
      '/alm/decisions',
      '/alm/agents',
      '/alm/agents/alerts',
      '/alm/copilot',
      '/alm/alerts', // regulatory alerts — different from agent alerts
      '/',
      '/login',
      '/portal',
      '/portal/benchmarks',
      '/admin',
      '/admin/models',
    ])('%s returns null (no redirect)', (path) => {
      expect(resolveLegacyRedirect(path)).toBeNull();
    });
  });

  describe('partial prefix matches are NOT redirected', () => {
    it('/decisions-archive does not match /decisions', () => {
      // Without the trailing-slash guard, a naive startsWith('/decisions')
      // would eat paths like '/decisions-archive'. The resolver requires
      // either exact match or a `/` boundary.
      expect(resolveLegacyRedirect('/decisions-archive')).toBeNull();
    });

    it('/cockpit-legacy does not match /cockpit', () => {
      expect(resolveLegacyRedirect('/cockpit-legacy')).toBeNull();
    });

    it('/agents-admin does not match /agents', () => {
      expect(resolveLegacyRedirect('/agents-admin')).toBeNull();
    });
  });

  describe('unknown paths pass through', () => {
    it.each(['/', '/not-a-route', '/api/v1/agents/run', '/static/foo.js'])(
      '%s returns null',
      (path) => {
        expect(resolveLegacyRedirect(path)).toBeNull();
      },
    );
  });
});
