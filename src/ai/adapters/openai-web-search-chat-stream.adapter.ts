import { Logger } from '@nestjs/common';
import type OpenAI from 'openai';
import type { ChatCompletionOptions, ChatMessage } from '../ports/chat-completion.port';
import type { ChatStreamPort } from '../ports/chat-stream.port';
import { AiAvailabilityService, AiUnavailableError, isQuotaError } from '../ai-availability';

export interface WebSearchStreamConfig {
  model: string;
  /** Responses API tool type; configurable because OpenAI renamed it (web_search_preview → web_search). */
  toolType: string;
  /** ISO country for local results (prices in local currency/shops), e.g. "UA". */
  country?: string;
}

/**
 * ChatStreamPort backed by the Responses API with the built-in web search tool.
 * The model decides on its own whether to search, so ordinary questions cost and
 * take the same as before; only "current" questions (prices, news, weather...) search.
 */
export class OpenAiWebSearchChatStreamAdapter implements ChatStreamPort {
  private readonly logger = new Logger(OpenAiWebSearchChatStreamAdapter.name);

  constructor(
    private readonly client: OpenAI,
    private readonly availability: AiAvailabilityService,
    private readonly cfg: WebSearchStreamConfig,
  ) {}

  async *stream(messages: ChatMessage[], options: ChatCompletionOptions = {}): AsyncIterable<string> {
    const tool = {
      type: this.cfg.toolType,
      search_context_size: 'low', // short answers for a watch: less context, faster, cheaper
      ...(this.cfg.country ? { user_location: { type: 'approximate', country: this.cfg.country } } : {}),
    };

    let events: AsyncIterable<{ type: string; delta?: string; error?: unknown }>;
    try {
      events = (await this.client.responses.create({
        model: this.cfg.model,
        input: messages.map((m) => ({ role: m.role, content: m.content })),
        tools: [tool],
        temperature: options.temperature ?? 0.3,
        stream: true,
      } as never)) as unknown as AsyncIterable<{ type: string; delta?: string; error?: unknown }>;
    } catch (err) {
      if (isQuotaError(err)) {
        this.availability.markUnavailable();
        throw new AiUnavailableError((err as Error).message);
      }
      throw err;
    }

    for await (const ev of events) {
      switch (ev.type) {
        case 'response.output_text.delta':
          if (ev.delta) yield ev.delta;
          break;
        case 'response.web_search_call.searching':
          this.logger.log('web search…');
          break;
        case 'response.failed':
        case 'error': {
          const err = (ev as { response?: { error?: unknown } }).response?.error ?? ev.error;
          if (isQuotaError(err)) {
            this.availability.markUnavailable();
            throw new AiUnavailableError();
          }
          throw new Error(`Responses stream failed: ${JSON.stringify(err)}`);
        }
      }
    }
  }
}
