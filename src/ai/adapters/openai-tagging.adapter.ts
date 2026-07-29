import { Injectable, Logger, Inject } from '@nestjs/common';
import type { TaggingPort } from '../ports/tagging.port';
import { CHAT_COMPLETION_PORT, ChatCompletionPort } from '../ports/chat-completion.port';

const SYSTEM_PROMPT =
  'Extract 3 to 5 short topical tags from the transcript. ' +
  'Tags must be in the same language as the transcript. ' +
  'Return ONLY a valid JSON array of lowercase strings, e.g. ["product launch","q3 planning","budget"]. ' +
  'No explanation, no markdown.';

@Injectable()
export class OpenAiTaggingAdapter implements TaggingPort {
  private readonly logger = new Logger(OpenAiTaggingAdapter.name);

  constructor(@Inject(CHAT_COMPLETION_PORT) private readonly chat: ChatCompletionPort) {}

  async extractTags(transcript: string): Promise<string[]> {
    const raw = await this.chat.complete(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcript.slice(0, 4000) },
      ],
      { temperature: 0, responseFormatJson: true },
    );
    try {
      const parsed = JSON.parse(raw ?? '[]');
      if (Array.isArray(parsed)) {
        const tags = parsed.filter((t): t is string => typeof t === 'string').slice(0, 5);
        this.logger.log(`← tags: ${tags.join(', ')}`);
        return tags;
      }
    } catch {
      this.logger.warn(`Failed to parse tags response: ${raw}`);
    }
    return [];
  }
}
