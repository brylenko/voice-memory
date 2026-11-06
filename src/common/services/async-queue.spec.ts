import { AsyncQueue } from './async-queue';

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('AsyncQueue', () => {
  it('yields items pushed before and after iteration starts, then ends', async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    const p = collect(q);
    q.push(2);
    setTimeout(() => { q.push(3); q.end(); }, 5);
    await expect(p).resolves.toEqual([1, 2, 3]);
  });

  it('drains buffered items before surfacing an error', async () => {
    const q = new AsyncQueue<string>();
    q.push('a');
    q.fail(new Error('boom'));
    const seen: string[] = [];
    await expect((async () => { for await (const x of q) seen.push(x); })()).rejects.toThrow('boom');
    expect(seen).toEqual(['a']);
  });

  it('ignores pushes after end', async () => {
    const q = new AsyncQueue<number>();
    q.end();
    q.push(1);
    await expect(collect(q)).resolves.toEqual([]);
  });
});
