/**
 * Minimal push → pull bridge between callback-style producers (WebSocket
 * events, stream listeners) and `for await` consumers.
 *
 * Producers call `push()` / `end()` / `fail()`; a single consumer iterates.
 * Items pushed before anyone iterates are buffered, so nothing is lost.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private waiter: (() => void) | null = null;
  private ended = false;
  private error: Error | null = null;

  push(item: T): void {
    if (this.ended) return;
    this.items.push(item);
    this.wake();
  }

  end(): void {
    this.ended = true;
    this.wake();
  }

  fail(err: Error): void {
    if (this.ended) return;
    this.error = err;
    this.ended = true;
    this.wake();
  }

  get isEnded(): boolean {
    return this.ended;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.items.length > 0) {
        yield this.items.shift()!;
        continue;
      }
      if (this.error) throw this.error;
      if (this.ended) return;
      await new Promise<void>((resolve) => { this.waiter = resolve; });
    }
  }

  private wake(): void {
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }
}
