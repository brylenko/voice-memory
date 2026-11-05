import type { ChatMessage } from '../../ai/ports/chat-completion.port';
import type { ChatStreamPort } from '../../ai/ports/chat-stream.port';
import { AssistantEvent, LiveAssistantSession } from './live-assistant.session';
import type { MemoryContextPort } from './ports/memory-context.port';

async function* stream(parts: string[], delayMs = 0): AsyncIterable<string> {
  for (const p of parts) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    yield p;
  }
}

function makeChat(reply: (messages: ChatMessage[]) => string[], delayMs = 0) {
  const calls: ChatMessage[][] = [];
  const chat: ChatStreamPort = {
    stream: (messages) => { calls.push(messages); return stream(reply(messages), delayMs); },
  };
  return { chat, calls };
}

function makeSession(opts: {
  chat: ChatStreamPort;
  memory?: MemoryContextPort | null;
  mode?: 'auto' | 'manual';
}) {
  const events: AssistantEvent[] = [];
  const session = new LiveAssistantSession(
    { chat: opts.chat, memory: opts.memory ?? null },
    { userId: 'u1', mode: opts.mode ?? 'auto' },
    (e) => events.push(e),
  );
  return { session, events };
}

describe('LiveAssistantSession', () => {
  it('streams an answer for a question in auto mode', async () => {
    const { chat } = makeChat(() => ['Around ', '384 000 km.']);
    const { session, events } = makeSession({ chat });

    session.onUtterance('utt-1', 'How far is the Moon?');
    await session.idle();

    expect(events.map((e) => e.type)).toEqual(['answer.start', 'answer.delta', 'answer.delta', 'answer.done']);
    expect(events[0]).toMatchObject({ inReplyTo: 'utt-1' });
    expect(events[3]).toMatchObject({ text: 'Around 384 000 km.' });
  });

  it('emits nothing when the model skips', async () => {
    const { chat } = makeChat(() => ['[SKIP]']);
    const { session, events } = makeSession({ chat });

    session.onUtterance('utt-1', 'Hi, how is it going');
    await session.idle();

    expect(events).toEqual([]);
  });

  it('manual mode only answers on askNow(), and the prompt forbids skipping', async () => {
    const { chat, calls } = makeChat(() => ['Hint.']);
    const { session, events } = makeSession({ chat, mode: 'manual' });

    session.onUtterance('utt-1', 'We should pick a date for the release');
    await session.idle();
    expect(calls).toHaveLength(0);

    session.askNow();
    await session.idle();
    expect(calls).toHaveLength(1);
    expect(calls[0][0].content).toContain('explicitly tapped');
    expect(events.at(-1)).toMatchObject({ type: 'answer.done', text: 'Hint.' });
  });

  it('coalesces utterances that arrive while an answer is generating', async () => {
    const { chat, calls } = makeChat(() => ['ok'], 15);
    const { session } = makeSession({ chat });

    session.onUtterance('1', 'first?');
    session.onUtterance('2', 'second?');
    session.onUtterance('3', 'third?');
    await session.idle();

    // one call for "1", then one coalesced call for the newest state ("3")
    expect(calls).toHaveLength(2);
    expect(calls[1][1].content).toContain('>> [');
    expect(calls[1][1].content).toMatch(/>> \[\d\d:\d\d\] third\?/);
  });

  it('includes relevant memory facts and survives memory failures', async () => {
    const { chat, calls } = makeChat(() => ['Tuesday.']);
    const memory: MemoryContextPort = {
      findRelevant: jest.fn()
        .mockResolvedValueOnce([{ text: 'Demo moved to Tuesday', heardAt: new Date('2026-11-04T10:00:00Z') }])
        .mockRejectedValueOnce(new Error('db down')),
    };
    const { session, events } = makeSession({ chat, memory });

    session.onUtterance('1', 'When is the demo?');
    await session.idle();
    expect(calls[0][1].content).toContain('Demo moved to Tuesday');

    session.onUtterance('2', 'And when exactly?');
    await session.idle();
    expect(calls).toHaveLength(2);
    expect(events.filter((e) => e.type === 'answer.done')).toHaveLength(2);
  });

  it('reports a model failure as answer.error without throwing', async () => {
    const chat: ChatStreamPort = {
      // eslint-disable-next-line require-yield
      stream: async function* () { throw new Error('429'); },
    };
    const { session, events } = makeSession({ chat });

    session.onUtterance('1', 'What time is it in Tokyo?');
    await session.idle();

    expect(events).toEqual([expect.objectContaining({ type: 'answer.error' })]);
  });

  it('stops emitting after close()', async () => {
    const { chat } = makeChat(() => ['a', 'b', 'c'], 10);
    const { session, events } = makeSession({ chat });

    session.onUtterance('1', 'Question?');
    await new Promise((r) => setTimeout(r, 15));
    session.close();
    await session.idle();

    expect(events.some((e) => e.type === 'answer.done')).toBe(false);
  });
});
