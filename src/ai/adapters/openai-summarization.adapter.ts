import { Injectable, Logger, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { TrackSummaries, ActionTask } from '../../audio-track/audio-track.entity';
import { SummarySection, SUMMARY_SECTIONS } from '../../audio-track/audio-track.entity';
import { SummarizationPort, SummaryTemplate } from '../ports/summarization.port';
import { CHAT_COMPLETION_PORT, ChatCompletionPort } from '../ports/chat-completion.port';

const LANG =
  'Detect the language of the transcript and write your entire response in that exact language.';

const NO_INVENT =
  'Use ONLY information from the transcript — do NOT invent dates, names, or placeholders like [указать] or [TBD]. If something is not mentioned, simply omit it.';

const TASKS_PROMPT =
  `Extract all action items / tasks from the transcript as a JSON array.
Each element: { "text": "<task description in the transcript language>" }.
Return ONLY the JSON array, no other text. If no tasks found, return [].
${NO_INVENT}`;

type SectionPrompts = Record<SummarySection, string>;

const TEMPLATES: Record<SummaryTemplate, SectionPrompts> = {
  meeting: {
    [SummarySection.Executive]:
      `${LANG} Write a brief executive summary of the meeting: 3-5 sentences about the main outcome. No bullet points, only coherent text. ${NO_INVENT}`,
    [SummarySection.ActionItems]:
      `${LANG} Extract all action items from the meeting. For each: who is responsible (if mentioned), what needs to be done, deadline (if mentioned). Format: bullet list.`,
    [SummarySection.KeyDecisions]:
      `${LANG} Extract only the key decisions made during the meeting. No discussion details — only final agreements. Format: bullet list.`,
    [SummarySection.Detailed]:
      `${LANG} Write a detailed structured summary of the meeting in chronological order. Preserve all important details, numbers, names. ${NO_INVENT}`,
  },
  interview: {
    [SummarySection.Executive]:
      `${LANG} Summarise this interview in 3-5 sentences: who was interviewed, main topics covered, overall impression. ${NO_INVENT}`,
    [SummarySection.ActionItems]:
      `${LANG} List any follow-up actions mentioned during the interview (next steps, reference checks, tasks for either party). Format: bullet list.`,
    [SummarySection.KeyDecisions]:
      `${LANG} List the key outcomes or agreements reached during the interview (e.g. candidate progresses, offer discussed, rejection). Format: bullet list.`,
    [SummarySection.Detailed]:
      `${LANG} Write a detailed structured summary of the interview: questions asked, answers given, notable moments. ${NO_INVENT}`,
  },
  lecture: {
    [SummarySection.Executive]:
      `${LANG} Summarise this lecture in 3-5 sentences: main topic, key concepts introduced, learning objectives covered. ${NO_INVENT}`,
    [SummarySection.ActionItems]:
      `${LANG} List homework, assignments, or tasks given to students during this lecture. Format: bullet list. If none mentioned, write "No assignments mentioned."`,
    [SummarySection.KeyDecisions]:
      `${LANG} List the core concepts or definitions the lecturer emphasised as most important. Format: bullet list.`,
    [SummarySection.Detailed]:
      `${LANG} Write detailed structured notes of the lecture in the order topics were covered. Include examples, formulas, and explanations. ${NO_INVENT}`,
  },
  sales_call: {
    [SummarySection.Executive]:
      `${LANG} Summarise this sales call in 3-5 sentences: prospect profile, main pain points, outcome of the call. ${NO_INVENT}`,
    [SummarySection.ActionItems]:
      `${LANG} List all next steps and commitments made by either party on this sales call (demos, proposals, follow-up calls). Format: bullet list with owner and deadline if mentioned.`,
    [SummarySection.KeyDecisions]:
      `${LANG} List what was agreed on this call (pricing discussed, objections resolved, deal stage moved). Format: bullet list.`,
    [SummarySection.Detailed]:
      `${LANG} Write a detailed structured summary of the sales call: prospect background, pain points raised, solutions presented, objections and responses, closing discussion. ${NO_INVENT}`,
  },
  custom: {
    [SummarySection.Executive]:
      `${LANG} Write a brief 3-5 sentence summary of the main topic and outcome of this recording. ${NO_INVENT}`,
    [SummarySection.ActionItems]:
      `${LANG} Extract any action items, tasks, or next steps mentioned. Format: bullet list. If none, write "No action items mentioned."`,
    [SummarySection.KeyDecisions]:
      `${LANG} Extract the key conclusions or decisions reached. Format: bullet list.`,
    [SummarySection.Detailed]:
      `${LANG} Write a detailed structured summary covering all important points in the order they were discussed. ${NO_INVENT}`,
  },
};

@Injectable()
export class OpenAiSummarizationAdapter implements SummarizationPort {
  private readonly logger = new Logger(OpenAiSummarizationAdapter.name);

  constructor(@Inject(CHAT_COMPLETION_PORT) private readonly chat: ChatCompletionPort) {}

  async summarize(fullText: string, template: SummaryTemplate = SummaryTemplate.Meeting): Promise<TrackSummaries> {
    const prompts = TEMPLATES[template];
    this.logger.log(
      `→ summarize: template=${template} running ${SUMMARY_SECTIONS.length + 1} prompts in parallel (text=${fullText.length} chars)`,
    );
    const t0 = Date.now();

    const [textResults, tasksRaw] = await Promise.all([
      Promise.all(
        SUMMARY_SECTIONS.map(async (key) => {
          const text = await this.chat.complete(
            [
              { role: 'system', content: prompts[key] },
              { role: 'user', content: fullText },
            ],
            { temperature: 0.2 },
          );
          return [key, text] as const;
        }),
      ),
      this.chat.complete(
        [
          { role: 'system', content: TASKS_PROMPT },
          { role: 'user', content: fullText },
        ],
        { temperature: 0, responseFormatJson: true },
      ),
    ]);

    const tasks = this.parseTasks(tasksRaw);
    this.logger.log(`← summarize: all done in ${Date.now() - t0}ms, tasks=${tasks.length}`);

    return {
      ...(Object.fromEntries(textResults) as Omit<TrackSummaries, 'tasks'>),
      tasks,
    };
  }

  private parseTasks(raw: string): ActionTask[] {
    try {
      const parsed = JSON.parse(raw || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is { text: string } => typeof item?.text === 'string' && item.text.trim().length > 0)
        .map((item) => ({ id: randomUUID(), text: item.text.trim(), done: false }));
    } catch {
      this.logger.warn(`Failed to parse tasks JSON: ${raw?.slice(0, 200)}`);
      return [];
    }
  }
}
