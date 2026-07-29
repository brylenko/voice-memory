import { Injectable } from '@nestjs/common';
import { OpenAiService } from '../../common/services/openai.service';
import { ChatCompletionOptions, ChatCompletionPort, ChatMessage } from '../ports/chat-completion.port';

@Injectable()
export class OpenAiChatCompletionAdapter implements ChatCompletionPort {
  constructor(private readonly openai: OpenAiService) {}

  async complete(messages: ChatMessage[], options: ChatCompletionOptions = {}): Promise<string> {
    const completion = await this.openai.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: options.temperature ?? 0.2,
      ...(options.responseFormatJson ? { response_format: { type: 'json_object' as const } } : {}),
    });
    return completion.choices[0]?.message?.content ?? '';
  }
}
