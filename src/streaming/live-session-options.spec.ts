import { finalUtterancesAsDeltas, parseLiveSessionOptions } from './live-session-options';
import type { UtteranceEvent } from '../ai/ports/utterance-transcription.port';

async function* events(list: UtteranceEvent[]) { yield* list; }

describe('parseLiveSessionOptions', () => {
  it('defaults to web-live without VAD', () => {
    expect(parseLiveSessionOptions(new URLSearchParams())).toEqual({ language: undefined, channel: 'web-live', vad: false });
  });

  it('accepts wear-live + vad + lang', () => {
    expect(parseLiveSessionOptions(new URLSearchParams('channel=wear-live&vad=1&lang=uk')))
      .toEqual({ language: 'uk', channel: 'wear-live', vad: true });
  });

  it('rejects unknown channels (no arbitrary values written to the DB)', () => {
    expect(parseLiveSessionOptions(new URLSearchParams('channel=telegram')).channel).toBe('web-live');
  });
});

describe('finalUtterancesAsDeltas', () => {
  it('emits only final utterances, space-separated', async () => {
    const out: string[] = [];
    for await (const d of finalUtterancesAsDeltas(events([
      { type: 'partial', utteranceId: 'a', text: 'Hel' },
      { type: 'final', utteranceId: 'a', text: 'Hello.' },
      { type: 'partial', utteranceId: 'b', text: 'Wor' },
      { type: 'final', utteranceId: 'b', text: 'World.' },
    ]))) out.push(d);
    expect(out.join('')).toBe('Hello. World.');
  });
});
