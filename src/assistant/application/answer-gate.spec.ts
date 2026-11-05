import { gateAnswer, SKIP_TOKEN } from './answer-gate';

function tokens(parts: string[], onReturn?: () => void): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => (i < parts.length ? { value: parts[i++], done: false } : { value: undefined, done: true }),
        return: async () => { onReturn?.(); return { value: undefined, done: true }; },
      };
    },
  } as AsyncIterable<string>;
}

async function text(it: AsyncIterable<string> | null): Promise<string | null> {
  if (!it) return null;
  let s = '';
  for await (const t of it) s += t;
  return s;
}

describe('gateAnswer', () => {
  it('returns null and aborts upstream when the reply starts with the skip token', async () => {
    const aborted = jest.fn();
    const gated = await gateAnswer(tokens(['[S', 'KIP', ']', ' never read'], aborted));
    expect(gated).toBeNull();
    expect(aborted).toHaveBeenCalled();
  });

  it('tolerates leading whitespace before the skip token', async () => {
    expect(await gateAnswer(tokens(['  ', SKIP_TOKEN]))).toBeNull();
  });

  it('passes through a real answer including the buffered prefix', async () => {
    const gated = await gateAnswer(tokens(['Paris', ' is the', ' capital.']));
    expect(await text(gated)).toBe('Paris is the capital.');
  });

  it('decides early once the prefix diverges from the skip token', async () => {
    const gated = await gateAnswer(tokens(['[1] ', 'see note']));
    expect(await text(gated)).toBe('[1] see note');
  });

  it('returns null for an empty stream', async () => {
    expect(await gateAnswer(tokens([]))).toBeNull();
  });

  it('handles a short answer that ends before the skip-token length', async () => {
    expect(await text(await gateAnswer(tokens(['42'])))).toBe('42');
  });
});
