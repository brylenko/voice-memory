import type { UtteranceEvent } from '../ai/ports/utterance-transcription.port';

/** Channels a live client may declare; anything else falls back to the default. */
const LIVE_CHANNELS = ['web-live', 'wear-live'] as const;
export type LiveChannel = (typeof LIVE_CHANNELS)[number];

export interface LiveSessionOptions {
  language?: string;
  channel: LiveChannel;
  /** Segment speech into utterances server-side so text is persisted while the conversation goes on. */
  vad: boolean;
}

export function parseLiveSessionOptions(params: URLSearchParams): LiveSessionOptions {
  const channel = params.get('channel');
  return {
    language: params.get('lang') ?? undefined,
    channel: (LIVE_CHANNELS as readonly string[]).includes(channel ?? '') ? (channel as LiveChannel) : 'web-live',
    vad: params.get('vad') === '1',
  };
}

/**
 * Adapts utterance events to the plain text-delta stream StreamingGateway
 * already understands (Adapter pattern): every finished utterance becomes one
 * delta, so the existing flush / finalize pipeline works unchanged.
 */
export async function* finalUtterancesAsDeltas(events: AsyncIterable<UtteranceEvent>): AsyncIterable<string> {
  let first = true;
  for await (const ev of events) {
    if (ev.type !== 'final') continue;
    yield first ? ev.text : ` ${ev.text}`;
    first = false;
  }
}
