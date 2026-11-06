/**
 * Is the user asking about their OWN past conversations (what the watch heard)?
 * Cheap and predictable on purpose: no extra model call on every utterance.
 *
 *  - 'today'  — "what did I hear today", "о чём сегодня говорили" → day summary + search
 *  - 'recall' — "о чём мы договорились", "что говорили про X", "напомни…" → date-aware search
 */
export type MemoryIntent = 'none' | 'recall' | 'today';

const TODAY = /(сегодня|за сегодня|за день|сьогодні|за сьогодні|today)/i;
/** Up to three words may sit between the parts ("что я СЕГОДНЯ слышал", "о чём мы ВЧЕРА С ОЛЕГОМ говорили"). */
const GAP = String.raw`(?:\s+\S+){0,3}?\s+`;
const RU_VERBS = 'слышал|слышала|слышали|говорил|говорила|говорили|обсуждал|обсуждали|решили|договорились|договаривались|сказал|сказала|сказали|шла речь';
const UK_VERBS = 'чув|чула|чули|казав|казала|казали|говорили|домовились|обговорювали|вирішили';
const EN_VERBS = 'hear|heard|say|said|discuss|discussed|agree|agreed|decide|decided';

/** "что … говорили" — a question about something said/heard/agreed. */
const SAID = new RegExp(
  [
    `(что|о ч[её]м|про что)${GAP}(${RU_VERBS})`,
    `(що|про що)${GAP}(${UK_VERBS})`,
    `what${GAP}(${EN_VERBS})`,
    `когда${GAP}(договорились|созвон|встреча)`,
  ].join('|'),
  'i',
);
/** …but only about OUR conversations: first person, or anchored in time. */
const FIRST_PERSON = /(^|\s)(я|мы|ми|нам|мне|i|we|us)(\s|[,.?!]|$)/i;
const TIME_ANCHOR = /(сегодня|вчера|утром|днём|днем|вечером|на встрече|на созвоне|сьогодні|вчора|вранці|today|yesterday|this morning)/i;
/** Unambiguous requests to recall. */
const EXPLICIT = /(напомни|вспомни|нагадай|пригадай|remind me|что было (сегодня|вчера|утром|днём|днем|вечером|на встрече|на созвоне)|мы договорились|договорились ли)/i;

export function detectMemoryIntent(request: string): MemoryIntent {
  // "Что вы обсуждали на прошлом проекте?" from an interviewer is NOT about our recordings.
  const isMemory = EXPLICIT.test(request) ||
    (SAID.test(request) && (FIRST_PERSON.test(request) || TIME_ANCHOR.test(request)));
  if (!isMemory) return 'none';
  return TODAY.test(request) ? 'today' : 'recall';
}
