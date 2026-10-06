import { PiiRedactorService } from './pii-redactor.service';

describe('PiiRedactorService', () => {
  let s: PiiRedactorService;

  beforeEach(() => {
    s = new PiiRedactorService();
  });

  describe('scan', () => {
    it('flags a valid SSN but not invalid high-area SSNs', () => {
      const findings = s.scan('SSN 123-45-6789 and fake 999-45-6789');
      expect(findings).toHaveLength(1);
      expect(findings[0].kind).toBe('ssn');
      expect(findings[0].raw).toBe('123-45-6789');
    });

    it('flags EIN', () => {
      const findings = s.scan('Employer ID 12-3456789');
      expect(findings.map((f) => f.kind)).toContain('ein');
    });

    it('Luhn-checks credit cards (rejects invalid)', () => {
      const bad = s.scan('Card 4111 1111 1111 1112'); // invalid Luhn
      expect(bad.find((f) => f.kind === 'credit_card')).toBeUndefined();
      const good = s.scan('Card 4111 1111 1111 1111'); // valid test PAN
      expect(good.find((f) => f.kind === 'credit_card')).toBeDefined();
    });

    it('ABA-checks routing numbers', () => {
      // 021000021 is a real valid routing number (J.P. Morgan NY)
      const good = s.scan('Routing 021000021 account 123456789012');
      expect(good.find((f) => f.kind === 'routing_number')).toBeDefined();
      // 111111111 is not a valid ABA checksum
      const bad = s.scan('Routing 111111111');
      expect(bad.find((f) => f.kind === 'routing_number')).toBeUndefined();
    });

    it('flags email and phone', () => {
      const findings = s.scan('Contact: cfo@example.com or (555) 123-4567');
      const kinds = findings.map((f) => f.kind).sort();
      expect(kinds).toEqual(['email', 'phone']);
    });

    it('flags DOB in ISO form', () => {
      const findings = s.scan('DOB: 1978-03-15');
      expect(findings.find((f) => f.kind === 'date_of_birth')).toBeDefined();
    });

    it('handles empty input', () => {
      expect(s.scan('')).toEqual([]);
    });
  });

  describe('redact', () => {
    it('replaces findings with labelled placeholders', () => {
      const out = s.redact('Contact cfo@example.com now.');
      expect(out.redacted).toBe('Contact [REDACTED:EMAIL] now.');
      expect(out.findings).toHaveLength(1);
    });

    it('redacts multiple findings in order', () => {
      const out = s.redact('Email cfo@example.com phone 555-123-4567');
      expect(out.redacted).toBe(
        'Email [REDACTED:EMAIL] phone [REDACTED:PHONE]',
      );
    });
  });

  describe('validate', () => {
    it('every finding becomes a BLOCK violation', () => {
      const vs = s.validate('SSN 123-45-6789');
      expect(vs).toHaveLength(1);
      expect(vs[0].rule).toBe('PII_LEAK');
      expect(vs[0].severity).toBe('BLOCK');
    });
  });
});
