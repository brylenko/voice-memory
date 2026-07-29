import { Inject, Injectable, Logger } from '@nestjs/common';
import { CHAT_COMPLETION_PORT, ChatCompletionPort } from '../ports/chat-completion.port';
import { AudioIntent, IntentClassifierPort, RecordingType } from '../ports/intent-classifier.port';

const SYSTEM_PROMPT = `You classify voice messages into exactly one of these categories:

"search_query" — the user is ASKING THE BOT to search their archive of past recordings.
  Signals: question addressed to the bot like "find", "what did we discuss", "remind me", "search". Words in any language that mean "find in my recordings", "what did we talk about", "tell me about X".
  NOT this: someone dictating their own plans or listing tasks to themselves.

"mark_task_done" — the user says they completed or finished a specific task/action item.
  Signals: words meaning "done", "finished", "completed", "I did it", "closed the task" — in any language.
  Extract the task description and return it as taskHint.

"list_tasks" — the user is ASKING THE BOT to show their saved open/pending tasks.
  Signals: direct commands TO THE BOT meaning "show my tasks", "open tasks", "what do I have pending" — in any language.
  NOT this: someone dictating what they need to do — that is a recording to be saved, not a query.
  When in doubt between list_tasks and custom — if the user is narrating their own plans/tasks rather than asking to see saved tasks, choose "custom".

"meeting" — a work meeting, discussion, or call with multiple topics / participants.
"interview" — a structured conversation where one person asks questions and another answers.
"lecture" — a monologue or educational session where one person explains a topic.
"sales_call" — a commercial conversation aimed at selling or buying something.
"custom" — any other recording: personal note, plan dictation, brainstorm, todo list dictation, reminder to self.
  When in doubt between list_tasks and custom — if the user is narrating their own plans/tasks rather than asking to see saved tasks, choose "custom".

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

type IntentPayload = { intent: string; taskHint?: string };

type IntentFactory = (payload: IntentPayload) => AudioIntent;

const INTENT_MAP: Record<string, IntentFactory> = {
  search_query:   () => ({ kind: 'search_query' }),
  list_tasks:     () => ({ kind: 'list_tasks' }),
  mark_task_done: (p) => ({ kind: 'mark_task_done', taskHint: p.taskHint ?? '' }),
};

const RECORDING_TYPES = new Set<string>(Object.values(RecordingType));

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
      const payload = JSON.parse(raw || '{}') as IntentPayload;
      const intent = payload.intent ?? RecordingType.Meeting;

      const factory = INTENT_MAP[intent];
      if (factory) {
        const result = factory(payload);
        this.logger.log(`← intent=${intent}${payload.taskHint ? ` taskHint="${payload.taskHint}"` : ''}`);
        return result;
      }

      const recordingType: RecordingType = RECORDING_TYPES.has(intent)
        ? (intent as RecordingType)
        : RecordingType.Meeting;

      this.logger.log(`← intent=recording recordingType=${recordingType}`);
      return { kind: 'recording', recordingType };
    } catch {
      this.logger.warn(`Failed to parse intent response, defaulting to meeting: ${raw}`);
      return { kind: 'recording', recordingType: RecordingType.Meeting };
    }
  }
}
