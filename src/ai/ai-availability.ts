import { Injectable, Logger } from '@nestjs/common';

/** The AI provider refused because the account has no quota/credits left. Not retryable soon. */
export class AiUnavailableError extends Error {
  readonly code = 'ai_unavailable' as const;
  constructor(message = 'AI provider quota exhausted') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

const QUOTA_MARKERS = new Set(['insufficient_quota', 'credit_balance_exhausted']);

/**
 * "No credits" (not retryable soon) vs a plain 429 rate limit (retryable).
 * OpenAI is inconsistent about where it puts the marker: REST errors use
 * `code: insufficient_quota`, realtime events send
 * `{ type: 'insufficient_quota', code: 'credit_balance_exhausted' }`.
 */
export function isQuotaError(err: unknown): boolean {
  const e = err as { code?: string; type?: string; error?: { code?: string; type?: string } } | undefined;
  return [e?.code, e?.type, e?.error?.code, e?.error?.type].some((v) => v !== undefined && QUOTA_MARKERS.has(v));
}

/** Wire-level code for clients, or undefined when the error is not an AI-availability problem. */
export function aiErrorCode(err: unknown): 'ai_unavailable' | undefined {
  return err instanceof AiUnavailableError ? 'ai_unavailable' : undefined;
}

/**
 * Remembers that the provider recently refused for lack of credits, so devices
 * can stop streaming/uploading instead of retrying into a wall. There is no
 * cheap way to ask the provider "do I have credits?", so availability returns
 * on its own after a cooldown; the next real call re-checks it.
 */
@Injectable()
export class AiAvailabilityService {
  private readonly logger = new Logger(AiAvailabilityService.name);
  private unavailableUntil = 0;

  constructor(private readonly cooldownMs = 5 * 60_000, private readonly now: () => number = Date.now) {}

  markUnavailable(): void {
    if (!this.isAvailable()) return;
    this.unavailableUntil = this.now() + this.cooldownMs;
    this.logger.warn(`AI provider quota exhausted — reporting AI as unavailable for ${this.cooldownMs / 1000}s`);
  }

  isAvailable(): boolean {
    return this.now() >= this.unavailableUntil;
  }

  status(): { available: boolean; retryAfterSeconds: number } {
    const left = Math.max(0, this.unavailableUntil - this.now());
    return { available: left === 0, retryAfterSeconds: Math.ceil(left / 1000) };
  }
}
