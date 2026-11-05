import { ConversationWindow } from './conversation-window';

const u = (id: string, text: string) => ({ id, text, at: new Date() });

describe('ConversationWindow', () => {
  it('keeps at most maxItems newest utterances', () => {
    const w = new ConversationWindow(2, 1000);
    w.add(u('1', 'a'));
    w.add(u('2', 'b'));
    w.add(u('3', 'c'));
    expect(w.snapshot().map((x) => x.id)).toEqual(['2', '3']);
    expect(w.latest?.id).toBe('3');
  });

  it('evicts oldest entries when the char budget is exceeded but never the latest', () => {
    const w = new ConversationWindow(10, 10);
    w.add(u('1', 'aaaaaa'));
    w.add(u('2', 'bbbbbb'));
    expect(w.snapshot().map((x) => x.id)).toEqual(['2']);
    w.add(u('3', 'x'.repeat(50)));
    expect(w.snapshot().map((x) => x.id)).toEqual(['3']);
  });
});
