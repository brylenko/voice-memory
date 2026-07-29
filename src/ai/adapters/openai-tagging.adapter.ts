import { Injectable, Logger, Inject } from '@nestjs/common';
import type { TaggingPort, TaggingResult } from '../ports/tagging.port';
import { CHAT_COMPLETION_PORT, ChatCompletionPort } from '../ports/chat-completion.port';

const SYSTEM_PROMPT = `Analyze the transcript and extract only genuinely important, non-obvious information that someone must not miss.

Return a JSON object with two keys:
- "tags": array of important entities — write them in the transcript's language. ONLY include:
    • named events with context: "English lesson", "call with lawyer", "board meeting" etc.
    • people with roles/titles: "lawyer Elena", "CEO Mark", "client Petrov" etc.
    • critical deadlines or decisions: "Friday deadline", "contract signing" etc.
    • company or project names if specifically mentioned
  DO NOT include generic words like "recording", "conversation", "video", "discussion", "meeting" without specific context.
  Return [] if nothing important found. Max 5 items.
- "eventDate": ISO 8601 datetime string if a specific future or scheduled meeting/call date-time is mentioned, or null

Examples:
{"tags":["call with lawyer","divorce case"],"eventDate":"2026-08-05T15:00:00"}
{"tags":["CEO Mark","contract signing","Friday deadline"],"eventDate":null}
{"tags":["client meeting","Q3 budget"],"eventDate":"2026-08-02T10:00:00"}
{"tags":[],"eventDate":null}

Rules for eventDate:
- Only extract if a concrete date AND time are mentioned (e.g. "tomorrow at 15:00", "Friday at 10:30", "August 5 at 9:00")
- If only a date without time: set time to 09:00
- Resolve relative dates against the recording date provided
- Return null if no specific scheduled event found

No explanation, no markdown.`;

@Injectable()
export class OpenAiTaggingAdapter implements TaggingPort {
  private readonly logger = new Logger(OpenAiTaggingAdapter.name);

  constructor(@Inject(CHAT_COMPLETION_PORT) private readonly chat: ChatCompletionPort) {}

  async extractTags(transcript: string, recordedAt: Date): Promise<TaggingResult> {
    const recordingDateStr = recordedAt.toISOString().slice(0, 10);
    const raw = await this.chat.complete(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Recording date: ${recordingDateStr}\n\nTranscript:\n${transcript.slice(0, 4000)}` },
      ],
      { temperature: 0, responseFormatJson: true },
    );
    try {
      const parsed = JSON.parse(raw ?? '{}');
      const arr: unknown = Array.isArray(parsed) ? parsed : parsed?.tags;
      const tags = Array.isArray(arr)
        ? arr.filter((t): t is string => typeof t === 'string').slice(0, 5)
        : [];

      let eventDate: Date | null = null;
      if (typeof parsed?.eventDate === 'string' && parsed.eventDate.length > 0) {
        const d = new Date(parsed.eventDate);
        if (!isNaN(d.getTime())) eventDate = d;
      }

      this.logger.log(`← tags: ${tags.join(', ')} | eventDate: ${eventDate?.toISOString() ?? 'null'}`);
      return { tags, eventDate };
    } catch {
      this.logger.warn(`Failed to parse tags response: ${raw}`);
      return { tags: [], eventDate: null };
    }
  }
}
