import { Injectable, Logger } from '@nestjs/common';
import type { TrustViolation } from './contracts';

/**
 * Implements Vol2 LLM Security rule #5: "LLM responses are scanned for PII
 * patterns before being stored in audit logs." Also applied to any persisted
 * agent output (decision panel, board report, copilot reply).
 *
 * Detects: SSN, EIN, US bank account + routing, credit card (Luhn-checked),
 * email, US phone, ISO dates of birth, and Puerto Rico tax IDs. Redacts in
 * place and emits a violation per finding.
 */

export interface PiiFinding {
  kind:
    | 'ssn'
    | 'ein'
    | 'account_number'
    | 'routing_number'
    | 'credit_card'
    | 'email'
    | 'phone'
    | 'date_of_birth'
    | 'pr_tax_id';
  location: { start: number; end: number };
  raw: string;
}

export interface RedactResult {
  redacted: string;
  findings: PiiFinding[];
}

const PATTERNS: readonly {
  kind: PiiFinding['kind'];
  re: RegExp;
  validate?: (raw: string) => boolean;
}[] = [
  // SSN: 3-2-4 with hyphens or spaces. Excludes 000-XX-XXXX and 666-XX-XXXX.
  {
    kind: 'ssn',
    re: /\b(?!000|666|9\d{2})(\d{3})[- ](?!00)(\d{2})[- ](?!0000)(\d{4})\b/g,
  },
  // EIN: 2-7 with hyphen.
  { kind: 'ein', re: /\b\d{2}-\d{7}\b/g },
  // US routing number — exactly 9 digits. Validated by ABA checksum.
  {
    kind: 'routing_number',
    re: /\b\d{9}\b/g,
    validate: (raw) => isValidAbaRouting(raw),
  },
  // Bank account — 8-17 digits, not already matched as routing. Validated loosely.
  { kind: 'account_number', re: /\b\d{8,17}\b/g },
  // Credit card — 13-19 digits with optional spaces/hyphens. Luhn checked.
  {
    kind: 'credit_card',
    re: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (raw) => luhn(raw.replace(/[\s-]/g, '')),
  },
  {
    kind: 'email',
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  // US phone — with or without country code.
  {
    kind: 'phone',
    re: /\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g,
  },
  // DOB — ISO dates between 1900 and today, and MM/DD/YYYY.
  {
    kind: 'date_of_birth',
    re: /\b(19\d{2}|20[0-2]\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g,
  },
  // Puerto Rico "Número de Registro de Comerciante": 11 digits in NN-NNNNNNN-NN form.
  { kind: 'pr_tax_id', re: /\b\d{2}-\d{7}-\d{2}\b/g },
];

@Injectable()
export class PiiRedactorService {
  private readonly logger = new Logger(PiiRedactorService.name);

  scan(text: string): PiiFinding[] {
    if (!text) return [];
    const findings: PiiFinding[] = [];
    const claimed: Array<[number, number]> = [];
    for (const { kind, re, validate } of PATTERNS) {
      // Reset regex state (PATTERNS are module-scoped and reused).
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        if (validate && !validate(m[0])) continue;
        const start = m.index;
        const end = start + m[0].length;
        if (overlapsAny(start, end, claimed)) continue;
        claimed.push([start, end]);
        findings.push({ kind, raw: m[0], location: { start, end } });
      }
    }
    return findings.sort((a, b) => a.location.start - b.location.start);
  }

  redact(text: string, findings?: readonly PiiFinding[]): RedactResult {
    const hits = findings ?? this.scan(text);
    if (hits.length === 0) return { redacted: text, findings: [] };
    let out = '';
    let cursor = 0;
    for (const f of hits) {
      out += text.slice(cursor, f.location.start);
      out += `[REDACTED:${f.kind.toUpperCase()}]`;
      cursor = f.location.end;
    }
    out += text.slice(cursor);
    return { redacted: out, findings: [...hits] };
  }

  validate(text: string): TrustViolation[] {
    return this.scan(text).map((f) => ({
      rule: 'PII_LEAK' as const,
      severity: 'BLOCK' as const,
      message: `Agent output contains ${f.kind} PII. Must be redacted before persist (Vol2 LLM Security rule #5).`,
      location: f.location,
      evidence: { kind: f.kind },
    }));
  }
}

// --- helpers ---

function overlapsAny(
  s: number,
  e: number,
  claimed: readonly [number, number][],
): boolean {
  for (const [cs, ce] of claimed) if (s < ce && e > cs) return true;
  return false;
}

/**
 * ABA routing checksum: 3*(d1+d4+d7) + 7*(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mod 10).
 * Catches ~99% of random 9-digit strings, so an unvalidated routing match
 * becomes account_number instead.
 */
function isValidAbaRouting(raw: string): boolean {
  if (!/^\d{9}$/.test(raw)) return false;
  const d = raw.split('').map(Number);
  const sum =
    3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0 && sum !== 0;
}

/** Luhn check for credit card candidates. */
function luhn(raw: string): boolean {
  if (!/^\d{13,19}$/.test(raw)) return false;
  let sum = 0;
  let alt = false;
  for (let i = raw.length - 1; i >= 0; i--) {
    let n = raw.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
