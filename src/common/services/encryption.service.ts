import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit IV recommended for GCM
const TAG_BYTES = 16;  // 128-bit auth tag

@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private key!: Buffer;
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('encryptionKey') ?? '';
    if (!raw) {
      this.logger.warn('ENCRYPTION_KEY not set — field encryption disabled. Set a 64-char hex key for production.');
      return;
    }
    const buf = Buffer.from(raw, 'hex');
    if (buf.length !== 32) {
      throw new Error(`ENCRYPTION_KEY must be 64 hex characters (32 bytes), got ${buf.length * 2}`);
    }
    this.key = buf;
    this.enabled = true;
    this.logger.log('Field encryption enabled (AES-256-GCM)');
  }

  // Encrypt a string → base64 envelope: <iv(12)><tag(16)><ciphertext>
  encrypt(plaintext: string): string {
    if (!this.enabled) return plaintext;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  // Decrypt base64 envelope → plaintext. Returns original if encryption is disabled or value looks unencrypted.
  decrypt(value: string): string {
    if (!this.enabled) return value;
    try {
      const buf = Buffer.from(value, 'base64');
      // Minimum length: IV + tag = 28 bytes
      if (buf.length < IV_BYTES + TAG_BYTES + 1) return value;
      const iv = buf.subarray(0, IV_BYTES);
      const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      return decipher.update(ciphertext) + decipher.final('utf8');
    } catch {
      // Not encrypted (legacy plain-text row) — return as-is
      return value;
    }
  }

  encryptJson(obj: object): string {
    return this.encrypt(JSON.stringify(obj));
  }

  decryptJson<T>(value: string): T {
    const raw = this.decrypt(value);
    return JSON.parse(raw) as T;
  }

  // Decrypt fullText and summaries fields on a track entity in-place.
  // Safe to call even when encryption is disabled or fields are already plain-text.
  decryptTrack<T extends { fullText?: string | null; summaries?: unknown }>(track: T): T {
    if (track.fullText) {
      track.fullText = this.decrypt(track.fullText);
    }
    if (track.summaries) {
      const raw = typeof track.summaries === 'string'
        ? track.summaries
        : JSON.stringify(track.summaries);
      try {
        track.summaries = this.decryptJson(raw);
      } catch {
        // already a plain object (non-encrypted legacy row parsed by TypeORM as jsonb)
      }
    }
    return track;
  }
}
