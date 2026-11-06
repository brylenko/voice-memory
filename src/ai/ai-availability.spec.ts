import { AiAvailabilityService, AiUnavailableError, aiErrorCode, isQuotaError } from './ai-availability';

describe('AiAvailabilityService', () => {
  it('reports unavailable during the cooldown, then recovers on its own', () => {
    let t = 1_000;
    const svc = new AiAvailabilityService(60_000, () => t);
    expect(svc.isAvailable()).toBe(true);

    svc.markUnavailable();
    expect(svc.status()).toEqual({ available: false, retryAfterSeconds: 60 });

    t += 59_000;
    expect(svc.isAvailable()).toBe(false);
    t += 1_000;
    expect(svc.status()).toEqual({ available: true, retryAfterSeconds: 0 });
  });

  it('does not extend the cooldown on repeated failures within it', () => {
    let t = 0;
    const svc = new AiAvailabilityService(60_000, () => t);
    svc.markUnavailable();
    t = 30_000;
    svc.markUnavailable();
    expect(svc.status().retryAfterSeconds).toBe(30);
  });
});

describe('quota error helpers', () => {
  it('recognises OpenAI insufficient_quota but not plain rate limits', () => {
    expect(isQuotaError({ status: 429, code: 'insufficient_quota' })).toBe(true);
    expect(isQuotaError({ error: { code: 'insufficient_quota' } })).toBe(true);
    expect(isQuotaError({ status: 429, code: 'rate_limit_exceeded' })).toBe(false);
  });

  it('recognises the realtime shape seen in production logs', () => {
    expect(isQuotaError({ type: 'insufficient_quota', code: 'credit_balance_exhausted', message: 'no credits' })).toBe(true);
    expect(isQuotaError({ type: 'invalid_request_error', code: 'invalid_value' })).toBe(false);
  });

  it('maps only AiUnavailableError to the wire code', () => {
    expect(aiErrorCode(new AiUnavailableError())).toBe('ai_unavailable');
    expect(aiErrorCode(new Error('x'))).toBeUndefined();
  });
});
