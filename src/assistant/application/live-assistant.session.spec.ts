import type { ChatMessage } from '../../ai/ports/chat-completion.port';
import type { ChatStreamPort } from '../../ai/ports/chat-stream.port';
import { AssistantEvent, LiveAssistantSession } from './live-assistant.session';
import type { MemoryContextPort } from './ports/memory-context.port';
import { AiUnavailableError } from '../../ai/ai-availability';

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
  debounceMs?: number;
}) {
  const events: AssistantEvent[] = [];
  const session = new LiveAssistantSession(
    { chat: opts.chat, memory: opts.memory ?? null, debounceMs: opts.debounceMs ?? 0 },
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
    expect(calls[0][0].content).toContain('the complete list');
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

  it('waits for the continuation of a request split by a pause and answers it once', async () => {
    const { chat, calls } = makeChat(() => ['S — Single Responsibility…']);
    const { session } = makeSession({ chat, debounceMs: 30 });

    session.onUtterance('1', 'дай название паттернов');
    await new Promise((r) => setTimeout(r, 10));
    session.onUtterance('2', 'на каждую букву SOLID');
    await session.idle();

    expect(calls).toHaveLength(1);
    // Both parts are marked as the current request (>>).
    expect(calls[0][1].content).toMatch(/>> \[\d\d:\d\d\] дай название паттернов/);
    expect(calls[0][1].content).toMatch(/>> \[\d\d:\d\d\] на каждую букву SOLID/);
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

  it('tags provider quota failures with ai_unavailable so the watch can pause', async () => {
    const chat: ChatStreamPort = {
      // eslint-disable-next-line require-yield
      stream: async function* () { throw new AiUnavailableError(); },
    };
    const { session, events } = makeSession({ chat });

    session.onUtterance('1', 'Who won?');
    await session.idle();

    expect(events).toEqual([expect.objectContaining({ type: 'answer.error', code: 'ai_unavailable' })]);
  });

  it('does not answer its own spoken answer picked up by the microphone', async () => {
    const { chat, calls } = makeChat(() => ['Пицца Domino’s — американская сеть пиццерий.']);
    const { session } = makeSession({ chat });

    session.onUtterance('1', 'доминос');
    await session.idle();
    session.onUtterance('2', 'пицца доминос американская сеть пиццерий');
    await session.idle();

    expect(calls).toHaveLength(1);
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

describe('buildAssistantMessages', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildAssistantMessages } = require('./assistant-prompt');
  const u = (text: string) => ({ id: '1', text, at: new Date('2026-11-06T10:00:00Z') });

  it('allows complete answers when the user explicitly asks for a list', () => {
    const [system] = buildAssistantMessages({ conversation: [u('опиши 9 пунктов GRASP')], memory: [], forced: false });
    expect(system.content).toContain('COMPLETELY');
    expect(system.content).toContain('each item on its own line');
    expect(system.content).toContain('literally');
    expect(system.content).not.toContain('Single Responsibility'); // no misleading acronym example
    expect(system.content).not.toContain('Strategy'); // no partial answer to copy either
  });

  it('tells the model to read transliterated terms phonetically and to explain bare terms', () => {
    const [system] = buildAssistantMessages({ conversation: [u('доминос')], memory: [], forced: false });
    expect(system.content).toContain('transliterated');
    expect(system.content).toContain('NOTHING BUT a single term');
  });
});

describe('currentRequestStart', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { currentRequestStart } = require('./assistant-prompt');
  const at = (s: number) => ({ id: String(s), text: 'x', at: new Date(s * 1000) });

  it('groups utterances finished within 4 s into the latest request', () => {
    expect(currentRequestStart([at(0), at(20), at(22), at(25)])).toBe(1);
    expect(currentRequestStart([at(0), at(10)])).toBe(1);
    expect(currentRequestStart([at(0)])).toBe(0);
  });
});
