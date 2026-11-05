import type { ChatMessage } from '../../ai/ports/chat-completion.port';
import { SKIP_TOKEN } from './answer-gate';
import type { HeardUtterance } from './conversation-window';
import type { MemoryFact } from './ports/memory-context.port';

/** Hard cap so an answer always fits a round watch face without scrolling forever. */
export const MAX_ANSWER_CHARS = 220;

const BASE_RULES = [
  'You are a discreet real-time assistant running on the user\'s smartwatch.',
  'You hear the live conversation around the user. The transcript comes from speech recognition and may contain errors.',
  `Keep every answer to at most 2 short sentences (under ${MAX_ANSWER_CHARS} characters): it is read at a glance on a small round screen.`,
  'No preamble, no markdown, no lists. Answer in the language of the conversation.',
  'If "Personal memory" contains something relevant, use it and say when it was heard. Never invent personal facts.',
];

const AUTO_RULES = [
  'Decide whether the LATEST utterance deserves a hint: a question (to anyone), a request for a fact, number, date, definition,',
  'translation, calculation, or a claim that is clearly wrong. Small talk, greetings and statements that need no help do NOT.',
  `If no hint is useful, reply with exactly ${SKIP_TOKEN} and nothing else.`,
];

const FORCED_RULES = [
  'The user explicitly tapped "Answer" on the watch: give the most useful short answer, fact or hint about the latest topic.',
  `Do not reply ${SKIP_TOKEN}.`,
];

const fmtTime = (d: Date) => d.toISOString().slice(11, 16);
const fmtDateTime = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

export function buildAssistantMessages(params: {
  conversation: readonly HeardUtterance[];
  memory: readonly MemoryFact[];
  forced: boolean;
  now?: Date;
}): ChatMessage[] {
  const { conversation, memory, forced, now = new Date() } = params;
  const system = [
    ...BASE_RULES,
    ...(forced ? FORCED_RULES : AUTO_RULES),
    `Current time (UTC): ${fmtDateTime(now)}.`,
  ].join('\n');

  const transcript = conversation
    .map((u, i) => `${i === conversation.length - 1 ? '>>' : '  '} [${fmtTime(u.at)}] ${u.text}`)
    .join('\n');

  const memoryBlock = memory.length
    ? memory.map((m) => `- (${fmtDateTime(m.heardAt)}) ${m.text}`).join('\n')
    : '(nothing relevant)';

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `Personal memory:\n${memoryBlock}\n\nLive conversation (latest marked >>):\n${transcript}`,
    },
  ];
}
