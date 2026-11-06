import { AiUnavailableError } from '../../../../ai/ai-availability';
import type { SpeechSynthesisPort } from '../../../../ai/ports/speech-synthesis.port';
import { SpeechEvent, SpeechRelay } from './speech-relay';

async function* chunks(list: Buffer[], delayMs = 0) {
  for (const c of list) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    yield c;
  }
}

function setup(stream: SpeechSynthesisPort['stream']) {
  const events: SpeechEvent[] = [];
  const audio: Buffer[] = [];
  const relay = new SpeechRelay({ stream }, (e) => events.push(e), (b) => audio.push(b));
  relay.enabled = true;
  return { relay, events, audio };
}

describe('SpeechRelay', () => {
  it('frames PCM between start/end and keeps every frame 16-bit aligned', async () => {
    const { relay, events, audio } = setup(() => chunks([Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6])]));
    await relay.speak('a1', 'hello');

    expect(events.map((e) => e.type)).toEqual(['speech.start', 'speech.end']);
    expect(events[0]).toMatchObject({ sampleRate: 24_000, encoding: 'pcm16le' });
    expect(audio.every((b) => b.length % 2 === 0)).toBe(true);
    expect(Buffer.concat(audio)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
  });

  it('does nothing while disabled', async () => {
    const stream = jest.fn();
    const { relay, events } = setup(stream);
    relay.enabled = false;
    await relay.speak('a1', 'hello');
    expect(stream).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('a newer answer interrupts the one being spoken', async () => {
    const { relay, events } = setup(() => chunks([Buffer.alloc(2), Buffer.alloc(2), Buffer.alloc(2)], 10));
    const first = relay.speak('a1', 'long answer');
    await new Promise((r) => setTimeout(r, 5));
    const second = relay.speak('a2', 'newer answer');
    await Promise.all([first, second]);

    expect(events).toContainEqual({ type: 'speech.end', id: 'a1', interrupted: true });
    expect(events).toContainEqual({ type: 'speech.end', id: 'a2' });
  });

  it('reports quota failures with the ai_unavailable code', async () => {
    // eslint-disable-next-line require-yield
    const { relay, events } = setup(async function* () { throw new AiUnavailableError(); });
    await relay.speak('a1', 'x');
    expect(events.at(-1)).toEqual({ type: 'speech.error', id: 'a1', code: 'ai_unavailable' });
  });
});
