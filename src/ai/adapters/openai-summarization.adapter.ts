import { Injectable, Logger, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { TrackSummaries, ActionTask } from '../../audio-track/audio-track.entity';
import { SummarizationPort, SummaryTemplate, SummarizationResult } from '../ports/summarization.port';
import { CHAT_COMPLETION_PORT, ChatCompletionPort } from '../ports/chat-completion.port';

const NO_INVENT =
  'Use ONLY information from the transcript — do NOT invent dates, names, or placeholders like [TBD]. If something is not mentioned, simply omit it or leave the field empty.';

const SYSTEM_PROMPT = (template: SummaryTemplate, recordingDate: string) => `You analyze a voice recording transcript and return a single JSON object with ALL fields populated.

Recording date (for resolving relative dates): ${recordingDate}
Recording type: ${template}

Return ONLY this JSON structure, no markdown, no explanation:
{
  "executive": "<3-5 sentence summary of the main outcome — coherent prose, no bullet points>",
  "actionItems": "<bullet list of all action items with owner and deadline if mentioned; 'No action items.' if none>",
  "keyDecisions": "<bullet list of key decisions/agreements made; 'No decisions.' if none>",
  "detailed": "<detailed structured notes in chronological order — preserve names, numbers, dates>",
  "tasks": [{"text": "<concrete task in transcript language>"}],
  "tags": ["<important entity>"],
  "eventDate": "<ISO 8601 datetime or null>"
}

Field rules:
- executive / actionItems / keyDecisions / detailed: write in the transcript's language. ${NO_INVENT}
- tasks: every concrete action the speaker needs to do — include conditional ones too (e.g. "call at 15:00 if not delivered"). Return [] only if truly no actions.
- tags: use NOUNS or noun phrases, never verbs/actions.
    RULE: tags for call/meeting/event types MUST be in English (call, meeting, zoom, interview, etc.) — they are used as identifiers.
    All other tags (people, projects, objects) write in the transcript's language.
    INCLUDE: event types in English ("call", "meeting", "interview", "English lesson"), people+roles, projects, named objects.
    SKIP: action verbs ("call back", "pick up", "check"), generic words without context.
    Example — transcript "pick up parcel from Nova Poshta, call at 15 if not delivered, English lesson at 12, LinkedIn project":
      tags: ["call", "English lesson", "Nova Poshta parcel", "LinkedIn project"]
    Max 5. Return [] if nothing specific.
- eventDate: ISO 8601 if a specific scheduled event with date+time is mentioned. Resolve relative dates against the recording date. No time → use 09:00. Return null if none.

${NO_INVENT}`;

type RawPayload = {
  executive?: string;
  actionItems?: string;
  keyDecisions?: string;
  detailed?: string;
  tasks?: Array<{ text?: unknown }>;
  tags?: unknown[];
  eventDate?: string | null;
};

@Injectable()
export class OpenAiSummarizationAdapter implements SummarizationPort {
  private readonly logger = new Logger(OpenAiSummarizationAdapter.name);

  constructor(@Inject(CHAT_COMPLETION_PORT) private readonly chat: ChatCompletionPort) {}

  async summarize(fullText: string, template: SummaryTemplate, recordedAt: Date): Promise<SummarizationResult> {
    const recordingDate = recordedAt.toISOString().slice(0, 10);
    this.logger.log(`→ summarize: template=${template} recordingDate=${recordingDate} text=${fullText.length} chars`);
    const t0 = Date.now();

    const raw = await this.chat.complete(
      [
        { role: 'system', content: SYSTEM_PROMPT(template, recordingDate) },
        { role: 'user', content: fullText.slice(0, 12000) },
      ],
      { temperature: 0.2, responseFormatJson: true },
    );

    try {
      const p = JSON.parse(raw || '{}') as RawPayload;

      const tasks = this.parseTasks(p.tasks);
      const tags = this.parseTags(p.tags);
      const eventDate = this.parseEventDate(p.eventDate);

      const summaries: TrackSummaries = {
        executive:    p.executive    ?? '',
        actionItems:  p.actionItems  ?? '',
        keyDecisions: p.keyDecisions ?? '',
        detailed:     p.detailed     ?? '',
        tasks,
      };

      this.logger.log(
        `← summarize: done in ${Date.now() - t0}ms — tasks=${tasks.length} tags=[${tags.join(', ')}] eventDate=${eventDate?.toISOString() ?? 'null'}`,
      );
      return { summaries, tags, eventDate };
    } catch {
      this.logger.warn(`Failed to parse summarization response: ${raw?.slice(0, 300)}`);
      return {
        summaries: { executive: '', actionItems: '', keyDecisions: '', detailed: '', tasks: [] },
        tags: [],
        eventDate: null,
      };
    }
  }

  private parseTasks(raw: unknown): ActionTask[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is { text: string } => typeof (item as { text?: unknown })?.text === 'string' && (item as { text: string }).text.trim().length > 0)
      .map((item) => ({ id: randomUUID(), text: (item as { text: string }).text.trim(), done: false }));
  }

  private parseTags(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .slice(0, 5);
  }

  private parseEventDate(raw: string | null | undefined): Date | null {
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
}
