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
  'Speech recognition splits one spoken request into several lines when the speaker pauses: all lines marked >> are ONE request.',
  'Answer length depends on what was asked:',
  `- a hint you offer on your own, or a simple factual question: at most 2 short sentences (under ${SHORT_ANSWER_CHARS} characters);`,
  '- a request for several items — list, name each, per letter/step/point, describe, explain, compare, give examples',
  '  ("перечисли", "опиши", "назови", "на каждую букву", "по пунктам", "N пунктов", "какие бывают"): answer COMPLETELY,',
  `  every item asked for, compactly (under ${LONG_ANSWER_CHARS} characters), one short line per item.`,
  '  Never replace the requested items with a definition of the topic.',
  'Examples of correct answers:',
  '  Q: "дай название паттернов на каждую букву SOLID" → "S — Single Responsibility: один класс — одна причина меняться.',
  '     O — Open/Closed: открыт для расширения, закрыт для изменения. L — Liskov Substitution: подтип заменяет базовый тип.',
  '     I — Interface Segregation: узкие интерфейсы вместо одного толстого. D — Dependency Inversion: зависеть от абстракций."',
  '  Q: "что такое SOLID" → "SOLID — пять принципов ООП-дизайна Роберта Мартина для гибкого и поддерживаемого кода."',
  'No preamble, no markdown (plain numbering is fine). Answer in the language of the conversation.',
  'If "Personal memory" contains something relevant, use it and say when it was heard. Never invent personal facts.',
  'You can search the web. Do it for anything current or local: prices, availability, news, weather, schedules,',
  'exchange rates, opening hours — and always when asked to look something up ("посмотри в интернете", "найди", "сколько стоит").',
  'For prices give a concrete range with currency and one shop or source name. Never output links or URLs.',
];

const AUTO_RULES = [
  'Decide whether the LATEST utterance deserves a hint: a question (to anyone), a request for a fact, number, date, definition,',
  'translation, calculation, or a claim that is clearly wrong. Only when the >> request is NOTHING BUT a single term,',
  'name, brand or place (e.g. just "доминос" or "Kubernetes") treat it as "what is this?" and explain it in one sentence.',
  'Small talk, greetings and statements that need no help do NOT deserve a hint.',
  'A request to look something up or to find a price is always worth answering.',
  `If no hint is useful, reply with exactly ${SKIP_TOKEN} and nothing else.`,
];

const FORCED_RULES = [
  'The user explicitly tapped "Answer" on the watch. If the >> lines contain a request or question, answer exactly that,',
  'following the length rules above (a requested list = the complete list). Only if there is no request at all,',
  'give the most useful short fact or hint about the latest topic.',
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

  const firstOfRequest = currentRequestStart(conversation);
  const transcript = conversation
    .map((u, i) => `${i >= firstOfRequest ? '>>' : '  '} [${fmtTime(u.at)}] ${u.text}`)
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

/** Utterances finished within this gap of each other are parts of one spoken request. */
export const REQUEST_JOIN_GAP_MS = 4_000;

/** Index of the first utterance belonging to the latest request (pauses split one request). */
export function currentRequestStart(conversation: readonly HeardUtterance[]): number {
  let i = conversation.length - 1;
  while (i > 0 && conversation[i].at.getTime() - conversation[i - 1].at.getTime() <= REQUEST_JOIN_GAP_MS) i--;
  return Math.max(i, 0);
}
