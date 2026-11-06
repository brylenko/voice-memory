import type { ChatMessage } from '../../ai/ports/chat-completion.port';
import { SKIP_TOKEN } from './answer-gate';
import type { HeardUtterance } from './conversation-window';
import type { MemoryFact } from './ports/memory-context.port';

/** Length of an unsolicited hint: readable at a glance on a round watch face. */
export const SHORT_ANSWER_CHARS = 220;
/** Length of a full answer the user explicitly asked for (list, description, explanation). */
export const LONG_ANSWER_CHARS = 900;
/** Hard stop for a runaway generation (the model ignoring the limits above). */
export const MAX_ANSWER_CHARS = LONG_ANSWER_CHARS + 300;

const BASE_RULES = [
  'You are a discreet real-time assistant running on the user\'s smartwatch.',
  'You hear the live conversation around the user. The transcript comes from speech recognition and may contain errors.',
  'Speech often mixes languages: an English word or brand may appear transliterated (e.g. "асид" = acid, "доминос" = Domino\'s).',
  'Interpret words by how they sound and answer about what was most likely meant.',
  'Answer length depends on what was asked:',
  `- a hint you offer on your own, or a simple factual question: at most 2 short sentences (under ${SHORT_ANSWER_CHARS} characters);`,
  '- an explicit request to list, describe, explain, compare or give steps ("перечисли", "опиши", "расскажи", "объясни",',
  `  "назови все", "N пунктов"): answer it COMPLETELY — every item asked for — but compactly, under ${LONG_ANSWER_CHARS} characters.`,
  '  For lists write one short line per item: "1. Name — what it means". Never replace the requested list with a definition.',
  'No preamble, no markdown (plain numbering is fine). Answer in the language of the conversation.',
  'If "Personal memory" contains something relevant, use it and say when it was heard. Never invent personal facts.',
  'You can search the web. Do it for anything current or local: prices, availability, news, weather, schedules,',
  'exchange rates, opening hours — and always when asked to look something up ("посмотри в интернете", "найди", "сколько стоит").',
  'For prices give a concrete range with currency and one shop or source name. Never output links or URLs.',
];

const AUTO_RULES = [
  'Decide whether the LATEST utterance deserves a hint: a question (to anyone), a request for a fact, number, date, definition,',
  'translation, calculation, or a claim that is clearly wrong. A bare term, name, brand or place said on its own',
  '(e.g. "доминос", "кислота", "Kubernetes") is an implicit "what is this?" → explain it in one sentence.',
  'Small talk, greetings and statements that need no help do NOT deserve a hint.',
  'A request to look something up or to find a price is always worth answering.',
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
