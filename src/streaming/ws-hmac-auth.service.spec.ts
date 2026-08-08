import { WsHmacAuthService, WsAuthError } from './ws-hmac-auth.service';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

const SECRET = 'test-hmac-secret';
const DEVICE_ID = 'device-SN-001';

function makeService(secret = SECRET) {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'device.hmacSecret') return secret;
      if (key === 'device.signatureTtlSeconds') return 300;
      return undefined;
    }),
  } as unknown as ConfigService;
  return new WsHmacAuthService(config);
}

function makeParams(overrides: {
  deviceId?: string;
  ts?: number;
  nonce?: string;
  sig?: string;
  secret?: string;
} = {}): URLSearchParams {
  const ts = overrides.ts ?? Math.floor(Date.now() / 1000);
  const nonce = overrides.nonce ?? 'random-nonce-abc123';
  const deviceId = overrides.deviceId ?? DEVICE_ID;
  const secret = overrides.secret ?? SECRET;
  const sig = overrides.sig ?? createHmac('sha256', secret)
    .update(`${deviceId}.${ts}.${nonce}`)
    .digest('hex');

  const params = new URLSearchParams();
  if (overrides.deviceId !== null) params.set('deviceId', deviceId);
  params.set('ts', String(ts));
  params.set('nonce', nonce);
  params.set('sig', sig);
  return params;
}

describe('WsHmacAuthService', () => {
  describe('valid credentials', () => {
    it('accepts valid HMAC and returns deviceId', () => {
      const svc = makeService();
      const result = svc.validate(makeParams());
      expect(result).toBe(DEVICE_ID);
    });
  });

  describe('invalid signature', () => {
    it('rejects tampered signature', () => {
      const svc = makeService();
      const params = makeParams({ sig: 'a'.repeat(64) });
      expect(() => svc.validate(params)).toThrow(WsAuthError);
      expect(() => svc.validate(makeParams({ sig: 'a'.repeat(64) }))).toThrow('Invalid signature');
    });

    it('rejects signature generated with wrong secret', () => {
      const svc = makeService(SECRET);
      const params = makeParams({ secret: 'wrong-secret' });
      expect(() => svc.validate(params)).toThrow(WsAuthError);
    });

    it('rejects non-hex signature without crashing', () => {
      const svc = makeService();
      const params = makeParams({ sig: 'not-valid-hex!!!' });
      expect(() => svc.validate(params)).toThrow(WsAuthError);
    });
  });

  describe('missing fields', () => {
    it('rejects when deviceId is missing', () => {
      const svc = makeService();
      const params = makeParams();
      params.delete('deviceId');
      expect(() => svc.validate(params)).toThrow(WsAuthError);
    });

    it('rejects when ts is missing', () => {
      const svc = makeService();
      const params = makeParams();
      params.delete('ts');
      expect(() => svc.validate(params)).toThrow(WsAuthError);
    });

    it('rejects when nonce is missing', () => {
      const svc = makeService();
      const params = makeParams();
      params.delete('nonce');
      expect(() => svc.validate(params)).toThrow(WsAuthError);
    });

    it('rejects when sig is missing', () => {
      const svc = makeService();
      const params = makeParams();
      params.delete('sig');
      expect(() => svc.validate(params)).toThrow(WsAuthError);
    });
  });

  describe('expired timestamp', () => {
    it('rejects timestamp older than TTL', () => {
      const svc = makeService();
      const oldTs = Math.floor(Date.now() / 1000) - 400; // 400s ago, TTL=300
      const params = makeParams({ ts: oldTs });
      expect(() => svc.validate(params)).toThrow(WsAuthError);
      expect(() => svc.validate(makeParams({ ts: oldTs }))).toThrow('Expired timestamp');
    });

    it('rejects timestamp far in the future', () => {
      const svc = makeService();
      const futureTs = Math.floor(Date.now() / 1000) + 400;
      const params = makeParams({ ts: futureTs });
      expect(() => svc.validate(params)).toThrow(WsAuthError);
    });
  });

  describe('replay protection', () => {
    it('rejects replayed nonce on second use', () => {
      const svc = makeService();
      const params = makeParams({ nonce: 'unique-nonce-xyz' });
      expect(svc.validate(params)).toBe(DEVICE_ID);

      // Second connection with same nonce — must be rejected even with valid sig
      const params2 = makeParams({ nonce: 'unique-nonce-xyz' });
      expect(() => svc.validate(params2)).toThrow(WsAuthError);
      expect(() => svc.validate(makeParams({ nonce: 'unique-nonce-xyz' }))).toThrow('Replayed nonce');
    });

    it('accepts different nonces from the same device', () => {
      const svc = makeService();
      expect(svc.validate(makeParams({ nonce: 'nonce-1' }))).toBe(DEVICE_ID);
      expect(svc.validate(makeParams({ nonce: 'nonce-2' }))).toBe(DEVICE_ID);
    });
  });
});
