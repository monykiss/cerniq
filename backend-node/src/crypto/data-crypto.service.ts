import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class DataCryptoService {
  private readonly logger = new Logger(DataCryptoService.name);
  private readonly algorithm = 'aes-256-gcm';

  private getKey(): Buffer | null {
    const key = process.env.DATA_ENCRYPTION_KEY;
    if (!key) {
      this.logger.warn(
        'DATA_ENCRYPTION_KEY not set — data will not be encrypted',
      );
      return null;
    }
    return Buffer.from(key, 'hex');
  }

  encrypt(plaintext: string): string {
    const key = this.getKey();
    if (!key) return plaintext; // graceful degradation if key not configured

    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const tag = cipher.getAuthTag();
    // Format: base64_ciphertext:base64_iv:base64_tag
    return `${encrypted}:${iv.toString('base64')}:${tag.toString('base64')}`;
  }

  decrypt(encryptedString: string): string {
    // Check if data is actually encrypted (contains the : separator pattern)
    if (!encryptedString.includes(':')) return encryptedString;

    const key = this.getKey();
    if (!key) return encryptedString;

    const parts = encryptedString.split(':');
    if (parts.length !== 3) return encryptedString; // not encrypted data

    const [ciphertext, ivB64, tagB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const decipher = createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
