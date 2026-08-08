import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * WebSocket HMAC authentication — mirrors the HTTP DeviceAuthGuard scheme.
 *
 * Expected query params on WS handshake:
 *   deviceId  — device serial number
 *   ts        — unix seconds (integer string)
 *   nonce     — random string, unique per connection (≥16 hex chars recommended)
 *   sig       — hex HMAC-SHA256( `${deviceId}.${ts}.${nonce}`, secret )
 *
 * The nonce provides replay protection: reusing a nonce within the TTL window
 * is rejected even if the signature is valid.
 */
@Injectable()
export class WsHmacAuthService {
  private readonly logger = new Logger(WsHmacAuthService.name);
  private readonly usedNonces = new Map<string, number>(); // nonce → expiresAt (unix ms)

  constructor(private readonly config: ConfigService) {}

  /**
   * Validates WS handshake credentials.
   * Returns `deviceId` on success, throws `WsAuthError` on failure.
   * Never logs the signature or nonce value — only logs the reason for rejection.
   */
  validate(params: URLSearchParams): string {
    const deviceId = params.get('deviceId') ?? '';
    const tsRaw    = params.get('ts')       ?? '';
    const nonce    = params.get('nonce')    ?? '';
    const sig      = params.get('sig')      ?? '';

    if (!deviceId || !tsRaw || !nonce || !sig) {
      throw new WsAuthError('Missing authentication parameters');
    }

    const ts = parseInt(tsRaw, 10);
    if (!Number.isFinite(ts)) {
      throw new WsAuthError('Invalid timestamp');
    }

    const ttlSeconds = this.config.get<number>('device.signatureTtlSeconds') ?? 300;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - ts) > ttlSeconds) {
      throw new WsAuthError('Expired timestamp');
    }

    this.evictExpiredNonces();
    if (this.usedNonces.has(nonce)) {
      throw new WsAuthError('Replayed nonce');
    }

    const secret = this.config.get<string>('device.hmacSecret') ?? '';
    const expected = createHmac('sha256', secret)
      .update(`${deviceId}.${ts}.${nonce}`)
      .digest('hex');

    let isValid = false;
    try {
      const expectedBuf = Buffer.from(expected, 'hex');
      const providedBuf = Buffer.from(sig, 'hex');
      isValid =
        expectedBuf.length === providedBuf.length &&
        timingSafeEqual(expectedBuf, providedBuf);
    } catch {
      // Buffer.from can throw on non-hex input — treat as invalid sig
    }

    if (!isValid) {
      throw new WsAuthError('Invalid signature');
    }

    // Consume the nonce — expires when the timestamp window expires
    const expiresAt = (ts + ttlSeconds) * 1000;
    this.usedNonces.set(nonce, expiresAt);

    return deviceId;
  }

  private evictExpiredNonces(): void {
    const now = Date.now();
    for (const [nonce, expiresAt] of this.usedNonces) {
      if (now > expiresAt) this.usedNonces.delete(nonce);
    }
  }
}

export class WsAuthError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'WsAuthError';
  }
}
