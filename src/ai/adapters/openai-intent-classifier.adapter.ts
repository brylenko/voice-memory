import { Inject, Injectable, Logger } from '@nestjs/common';
import { CHAT_COMPLETION_PORT, ChatCompletionPort } from '../ports/chat-completion.port';
import type { AudioIntent, IntentClassifierPort, RecordingType } from '../ports/intent-classifier.port';

const SYSTEM_PROMPT = `You classify voice messages into exactly one of these categories:

"search_query" — the user asks a question or gives a search command directed at their archive of past recordings.
  Signals: question words (what, who, when, where, how, найди, що, хто, коли), phrases like "find", "search", "remind me", "what did we discuss", direct address to assistant.

"mark_task_done" — the user says they completed or finished a specific task/action item.
  Signals: "виконав", "зробив", "готово", "done", "finished", "completed", "закрив задачу", "вже зробили".
  Extract the task description and return it as taskHint.

"list_tasks" — the user asks to see their open/pending tasks or todo list.
  Signals: "мої задачі", "що треба зробити", "open tasks", "show tasks", "список задач", "невиконані".

"meeting" — a work meeting, discussion, or call with multiple topics / participants.
"interview" — a structured conversation where one person asks questions and another answers (job interview, journalistic interview, research interview).
"lecture" — a monologue or educational session where one person explains a topic (lecture, lesson, course, webinar, tutorial).
"sales_call" — a commercial conversation aimed at selling or buying something (demo, pitch, negotiation, customer discovery call).
"custom" — any other recording (personal note, brainstorm, dictation, podcast, conversation that doesn't fit above).

Respond with ONLY JSON in one of these shapes:
  {"intent": "search_query"}
  {"intent": "mark_task_done", "taskHint": "<what the user says they completed>"}
  {"intent": "list_tasks"}
  {"intent": "meeting"}
  {"intent": "interview"}
  {"intent": "lecture"}
  {"intent": "sales_call"}
  {"intent": "custom"}
No other text.`;

const RECORDING_TYPES = new Set<RecordingType>(['meeting', 'interview', 'lecture', 'sales_call', 'custom']);

@Injectable()
export class OpenAiIntentClassifierAdapter implements IntentClassifierPort {
  private readonly logger = new Logger(OpenAiIntentClassifierAdapter.name);

  constructor(@Inject(CHAT_COMPLETION_PORT) private readonly chat: ChatCompletionPort) {}

  async classify(transcribedText: string): Promise<AudioIntent> {
    this.logger.log(`→ classify intent (${transcribedText.length} chars): "${transcribedText.slice(0, 80)}..."`);

    const raw = await this.chat.complete(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcribedText },
      ],
      { temperature: 0, responseFormatJson: true },
    );

    try {
      const parsed = JSON.parse(raw || '{}') as { intent?: string };
      const intent = parsed.intent ?? 'meeting';

      if (intent === 'search_query') {
        this.logger.log(`← intent=search_query`);
        return { kind: 'search_query' };
      }

      if (intent === 'list_tasks') {
        this.logger.log(`← intent=list_tasks`);
        return { kind: 'list_tasks' };
      }

      if (intent === 'mark_task_done') {
        const taskHint = (parsed as { taskHint?: string }).taskHint ?? '';
        this.logger.log(`← intent=mark_task_done taskHint="${taskHint}"`);
        return { kind: 'mark_task_done', taskHint };
      }

      const recordingType: RecordingType = RECORDING_TYPES.has(intent as RecordingType)
        ? (intent as RecordingType)
        : 'meeting';

      this.logger.log(`← intent=recording recordingType=${recordingType}`);
      return { kind: 'recording', recordingType };
    } catch {
      this.logger.warn(`Failed to parse intent response, defaulting to meeting: ${raw}`);
      return { kind: 'recording', recordingType: 'meeting' };
    }
  }
}
