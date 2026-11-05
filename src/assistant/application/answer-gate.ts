/** Token the model emits when nothing in the conversation deserves an answer. */
export const SKIP_TOKEN = '[SKIP]';

/**
 * Lets a single streaming LLM call both *decide* whether to answer and
 * *produce* the answer, instead of paying for a separate classification call.
 *
 * Buffers just enough leading tokens to tell whether the reply starts with
 * the skip token:
 *  - it does   → resolves to `null` and stops consuming (aborts the upstream stream)
 *  - it doesn't → resolves to an iterable replaying the buffered prefix, then the rest
 */
export async function gateAnswer(
  tokens: AsyncIterable<string>,
  skipToken: string = SKIP_TOKEN,
): Promise<AsyncIterable<string> | null> {
  const iterator = tokens[Symbol.asyncIterator]();
  let prefix = '';

  while (true) {
    const trimmed = prefix.trimStart();
    if (trimmed.length >= skipToken.length || (trimmed && !skipToken.startsWith(trimmed))) break;
    const next = await iterator.next();
    if (next.done) {
      return prefix.trim() === '' || prefix.trim() === skipToken ? null : replay(prefix, iterator, true);
    }
    prefix += next.value;
  }

  if (prefix.trimStart().startsWith(skipToken)) {
    await iterator.return?.();
    return null;
  }
  return replay(prefix, iterator, false);
}

async function* replay(
  prefix: string,
  iterator: AsyncIterator<string>,
  exhausted: boolean,
): AsyncIterable<string> {
  const head = prefix.trimStart();
  if (head) yield head;
  if (exhausted) return;
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    // Consumer stopped early (session closed) → propagate abort upstream.
    await iterator.return?.();
  }
}
