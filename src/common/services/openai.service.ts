import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/**
 * Thin wrapper around the OpenAI SDK client. Centralising instantiation here
 * means every consumer (STT, embeddings, batch summarisation, RAG NLU/answer)
 * shares one client and one place to swap credentials/base URL (DIP: callers
 * depend on this abstraction, not on `new OpenAI()` scattered around the app).
 */
@Injectable()
export class OpenAiService {
  public readonly client: OpenAI;

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.get<string>('openaiApiKey'),
      // BullMQ owns retries with exponential backoff — let OpenAI SDK throw
      // immediately on any error so BullMQ can apply its retry policy.
      // timeout: 120s covers the longest expected STT call (~10 min audio).
      maxRetries: 0,
      timeout: 120_000,
    });
  }
}
