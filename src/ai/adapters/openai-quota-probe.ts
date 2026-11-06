import { Injectable, Logger } from '@nestjs/common';
import { OpenAiService } from '../../common/services/openai.service';
import { AiAvailabilityService, isQuotaError } from '../ai-availability';

const PROBE_INTERVAL_MS = 5 * 60_000;

/**
 * Answers "does the account still have credits?" with the cheapest possible
 * real call (1 output token), at most once per interval and de-duplicated
 * across concurrent callers. Only the watch status endpoint uses it.
 */
@Injectable()
export class OpenAiQuotaProbe {
  private readonly logger = new Logger(OpenAiQuotaProbe.name);
  private lastProbeAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly openai: OpenAiService,
    private readonly availability: AiAvailabilityService,
    private readonly now: () => number = Date.now,
  ) {}

  ensureFresh(): Promise<void> {
    if (!this.availability.isAvailable()) return Promise.resolve(); // already known: no credits
    if (this.now() - this.lastProbeAt < PROBE_INTERVAL_MS) return Promise.resolve();
    this.inflight ??= this.probe().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async probe(): Promise<void> {
    this.lastProbeAt = this.now();
    try {
      await this.openai.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      });
    } catch (err) {
      if (isQuotaError(err)) this.availability.markUnavailable();
      else this.logger.warn(`quota probe failed (ignored): ${(err as Error).message}`);
    }
  }
}
