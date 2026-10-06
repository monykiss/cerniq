import { Test, TestingModule } from '@nestjs/testing';
import { DataCryptoService } from './data-crypto.service';
import * as crypto from 'crypto';

describe('DataCryptoService', () => {
  let service: DataCryptoService;

  beforeEach(async () => {
    // Generate a valid 256-bit key (32 bytes as hex = 64 hex chars)
    process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

    const module: TestingModule = await Test.createTestingModule({
      providers: [DataCryptoService],
    }).compile();

    service = module.get<DataCryptoService>(DataCryptoService);
  });

  afterEach(() => {
    delete process.env.DATA_ENCRYPTION_KEY;
  });

  describe('encrypt + decrypt round-trip', () => {
    it('should encrypt and decrypt a simple string', () => {
      const plaintext = 'Hello, Cooperativa ABC!';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(encrypted).not.toBe(plaintext);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt CSV balance sheet data', () => {
      const csv = [
        'category,item,amount,rate,maturity_months',
        'asset,Cash and Equivalents,125000000,0.00,0',
        'asset,Investment Securities,350000000,3.75,48',
        'asset,Loans Receivable,680000000,5.25,120',
        'liability,Member Deposits,890000000,1.50,12',
        'liability,Borrowed Funds,150000000,4.25,60',
      ].join('\n');

      const encrypted = service.encrypt(csv);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(csv);
    });

    it('should handle empty string', () => {
      const encrypted = service.encrypt('');
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe('');
    });

    it('should handle unicode characters (Spanish bilingual content)', () => {
      const text = 'Cooperativa de Ahorro y Crédito — Análisis ALM ñ á é í ó ú';
      const encrypted = service.encrypt(text);
      expect(service.decrypt(encrypted)).toBe(text);
    });
  });

  describe('encrypt format', () => {
    it('should produce ciphertext:iv:tag format', () => {
      const encrypted = service.encrypt('test');
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);

      // All parts should be valid base64
      for (const part of parts) {
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
      }
    });

    it('should produce unique ciphertexts for same plaintext (random IV)', () => {
      const plaintext = 'same input';
      const enc1 = service.encrypt(plaintext);
      const enc2 = service.encrypt(plaintext);

      expect(enc1).not.toBe(enc2); // different IVs
      expect(service.decrypt(enc1)).toBe(plaintext);
      expect(service.decrypt(enc2)).toBe(plaintext);
    });
  });

  describe('graceful degradation without key', () => {
    it('should return plaintext when DATA_ENCRYPTION_KEY is not set', () => {
      delete process.env.DATA_ENCRYPTION_KEY;

      const module = new DataCryptoService();
      const plaintext = 'sensitive balance sheet data';

      expect(module.encrypt(plaintext)).toBe(plaintext);
      expect(module.decrypt(plaintext)).toBe(plaintext);
    });
  });

  describe('decrypt edge cases', () => {
    it('should return unencrypted data as-is (no colon separators)', () => {
      const raw = 'this is not encrypted data';
      expect(service.decrypt(raw)).toBe(raw);
    });

    it('should return malformed encrypted data as-is (wrong part count)', () => {
      const bad = 'part1:part2';
      expect(service.decrypt(bad)).toBe(bad);
    });
  });

  describe('tamper detection (GCM auth tag)', () => {
    it('should throw on tampered ciphertext', () => {
      const encrypted = service.encrypt('secret data');
      const parts = encrypted.split(':');

      // Tamper with the ciphertext portion
      const tamperedCiphertext = Buffer.from('tampered').toString('base64');
      const tampered = `${tamperedCiphertext}:${parts[1]}:${parts[2]}`;

      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('should throw on tampered auth tag', () => {
      const encrypted = service.encrypt('secret data');
      const parts = encrypted.split(':');

      // Tamper with the auth tag
      const tamperedTag = Buffer.from('0000000000000000').toString('base64');
      const tampered = `${parts[0]}:${parts[1]}:${tamperedTag}`;

      expect(() => service.decrypt(tampered)).toThrow();
    });
  });
});
