export interface HeardUtterance {
  id: string;
  text: string;
  at: Date;
}

/**
 * Rolling window over the most recent utterances — bounded both by count and
 * by total characters so the prompt stays small (latency + cost) no matter how
 * long the watch keeps listening.
 */
export class ConversationWindow {
  private readonly items: HeardUtterance[] = [];

  constructor(
    private readonly maxItems = 12,
    private readonly maxChars = 2_000,
  ) {}

  add(utterance: HeardUtterance): void {
    this.items.push(utterance);
    while (
      this.items.length > this.maxItems ||
      (this.items.length > 1 && this.totalChars() > this.maxChars)
    ) {
      this.items.shift();
    }
  }

  get latest(): HeardUtterance | undefined {
    return this.items[this.items.length - 1];
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  snapshot(): readonly HeardUtterance[] {
    return [...this.items];
  }

  private totalChars(): number {
    return this.items.reduce((sum, u) => sum + u.text.length, 0);
  }
}
