import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiService } from '../../common/services/openai.service';
import type { ChatCompletionOptions, ChatMessage } from '../ports/chat-completion.port';
import type { ChatStreamPort } from '../ports/chat-stream.port';
import { AiAvailabilityService, AiUnavailableError, isQuotaError } from '../ai-availability';

@Injectable()
export class OpenAiChatStreamAdapter implements ChatStreamPort {
  constructor(
    private readonly openai: OpenAiService,
    private readonly availability: AiAvailabilityService,
    private readonly config: ConfigService,
  ) {}

  async *stream(messages: ChatMessage[], options: ChatCompletionOptions = {}): AsyncIterable<string> {
    let stream;
    try {
      stream = await this.openai.client.chat.completions.create({
        model: this.config.get<string>('assistant.model') ?? 'gpt-4o-mini',
        messages,
        temperature: options.temperature ?? 0.3,
        stream: true,
      });
    } catch (err) {
      if (isQuotaError(err)) {
        this.availability.markUnavailable();
        throw new AiUnavailableError((err as Error).message);
      }
      throw err;
    }
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
