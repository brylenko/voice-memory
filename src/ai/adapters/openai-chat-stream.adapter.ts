import { Injectable } from '@nestjs/common';
import { OpenAiService } from '../../common/services/openai.service';
import type { ChatCompletionOptions, ChatMessage } from '../ports/chat-completion.port';
import type { ChatStreamPort } from '../ports/chat-stream.port';

@Injectable()
export class OpenAiChatStreamAdapter implements ChatStreamPort {
  constructor(private readonly openai: OpenAiService) {}

  async *stream(messages: ChatMessage[], options: ChatCompletionOptions = {}): AsyncIterable<string> {
    const stream = await this.openai.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: options.temperature ?? 0.3,
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
