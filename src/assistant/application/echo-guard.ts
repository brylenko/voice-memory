/**
 * Detects the assistant hearing *itself*: when an answer is spoken aloud (watch
 * speaker, earbuds nearby) the microphone picks it up and it comes back as a new
 * "utterance" — answering that creates an endless loop.
 *
 * Heuristic: an utterance is an echo if, within the time window, most of its
 * words appear in one of the recent answers. Cheap, language-agnostic, no ML.
 */
export class EchoGuard {
  private readonly recent: Array<{ words: Set<string>; at: number }> = [];

  constructor(
    private readonly windowMs = 15_000,
    private readonly overlapThreshold = 0.8,
    private readonly now: () => number = Date.now,
  ) {}

  rememberAnswer(text: string): void {
    const words = tokenize(text);
    if (words.size === 0) return;
    this.recent.push({ words, at: this.now() });
    if (this.recent.length > 5) this.recent.shift();
  }

  isEcho(utterance: string): boolean {
    // Answers are statements; a question is the user asking (again) — never an echo,
    // even when it reuses the answer's words ("а что ещё про Facade?").
    if (/[?？]\s*$/.test(utterance.trim())) return false;
    const words = tokenize(utterance);
    if (words.size === 0) return false;
    // A single word is an echo only if it's a distinctive word from a recent answer
    // (e.g. "итератор" read aloud from the answer); short common words never count.
    if (words.size === 1) {
      const [w] = words;
      if (w.length < 5) return false;
    }
    const cutoff = this.now() - this.windowMs;
    return this.recent.some((a) => {
      if (a.at < cutoff) return false;
      let shared = 0;
      for (const w of words) if (a.words.has(w)) shared++;
      return shared / words.size >= this.overlapThreshold;
    });
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3),
  );
}
