import { randomUUID } from 'crypto';
import type { ChatStreamPort } from '../../ai/ports/chat-stream.port';
import { gateAnswer } from './answer-gate';
import { aiErrorCode } from '../../ai/ai-availability';
import { buildAssistantMessages, MAX_ANSWER_CHARS } from './assistant-prompt';
import { ConversationWindow } from './conversation-window';
import { EchoGuard } from './echo-guard';
import { stripDeltaMarkup, toPlainText } from './plain-text';
import type { MemoryContextPort, MemoryFact } from './ports/memory-context.port';

/**
 * - `auto`   — answer on its own whenever the latest utterance deserves it
 * - `manual` — only listen; answer when the user taps "Answer" (`askNow()`)
 */
export type AssistantMode = 'auto' | 'manual';

export type AssistantEvent =
  | { type: 'answer.start'; id: string; inReplyTo: string }
  | { type: 'answer.delta'; id: string; text: string }
  | { type: 'answer.done'; id: string; text: string }
  | { type: 'answer.error'; id: string; message: string; code?: 'ai_unavailable' };

export interface LiveAssistantDeps {
  chat: ChatStreamPort;
  memory: MemoryContextPort | null;
  log?: (msg: string) => void;
  /** Decision trace (skip / answer), for diagnostics. Never receives user text. */
  trace?: (msg: string) => void;
  /** Wait this long after an utterance for a continuation before answering (auto mode). */
  debounceMs?: number;
  /** DEV ONLY: receives heard text and answers for debugging. Off unless explicitly enabled. */
  debugText?: (msg: string) => void;
}

export interface LiveAssistantContext {
  userId: string;
  mode: AssistantMode;
  memoryFacts?: number;
}

/**
 * One listening session on one watch. Pure application logic: receives
 * finished utterances, decides when to think, streams short answers out via
 * `emit`. Knows nothing about WebSockets, OpenAI or Postgres.
 *
 * Concurrency: evaluations are serialized. Utterances arriving while an
 * answer is being generated are *coalesced* — after it finishes, only the
 * newest state of the conversation is evaluated once (no backlog of stale answers).
 */
export class LiveAssistantSession {
  private readonly window = new ConversationWindow();
  private running = false;
  private pending: { forced: boolean } | null = null;
  private lastEvaluatedId: string | null = null;
  private readonly echo = new EchoGuard();
  private closed = false;
  private mode: AssistantMode;

  constructor(
    private readonly deps: LiveAssistantDeps,
    private readonly ctx: LiveAssistantContext,
    private readonly emit: (event: AssistantEvent) => void,
  ) {
    this.mode = ctx.mode;
  }

  setMode(mode: AssistantMode): void {
    this.mode = mode;
  }

  onUtterance(id: string, text: string, at: Date = new Date()): void {
    if (this.closed || !text.trim()) return;
    if (this.echo.isEcho(text)) {
      // Our own spoken answer came back through the microphone — never answer it.
      this.deps.trace?.('ignored echo of a recent answer');
      return;
    }
    this.window.add({ id, text: text.trim(), at });
    this.deps.debugText?.(`heard: ${text.trim()}`);
    if (this.mode === 'auto') this.scheduleDebounced();
  }

  private debounceTimer: NodeJS.Timeout | null = null;

  /** A pause mid-sentence splits one request into utterances: answer once, after it's complete. */
  private scheduleDebounced(): void {
    const delay = this.deps.debounceMs ?? 700;
    if (delay <= 0) { this.schedule(false); return; }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.schedule(false);
    }, delay);
  }

  /** User explicitly asked for an answer about what was just said. */
  askNow(): void {
    if (this.closed || this.window.isEmpty) return;
    this.schedule(true);
  }

  close(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.closed = true;
    this.pending = null;
  }

  /** Resolves once all scheduled evaluations have finished (used by tests / graceful close). */
  async idle(): Promise<void> {
    while (this.running || this.debounceTimer) await new Promise((r) => setTimeout(r, 5));
  }

  private schedule(forced: boolean): void {
    this.pending = { forced: forced || (this.pending?.forced ?? false) };
    if (!this.running) void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.pending && !this.closed) {
        const { forced } = this.pending;
        this.pending = null;
        await this.evaluate(forced);
      }
    } finally {
      this.running = false;
    }
  }

  private async evaluate(forced: boolean): Promise<void> {
    const latest = this.window.latest;
    if (!latest) return;
    if (!forced && latest.id === this.lastEvaluatedId) return;
    this.lastEvaluatedId = latest.id;

    const answerId = randomUUID();
    let started = false;
    let answer = '';

    try {
      const memory = await this.lookupMemory(latest.text);
      const messages = buildAssistantMessages({
        conversation: this.window.snapshot(),
        memory,
        forced,
      });

      const gated = await gateAnswer(this.deps.chat.stream(messages, { temperature: 0.3 }));
      if (!gated) {
        this.deps.trace?.(`skip (no hint needed, forced=${forced})`);
        return;
      }

      for await (const delta of gated) {
        if (this.closed) break;
        if (!started) {
          started = true;
          this.emit({ type: 'answer.start', id: answerId, inReplyTo: latest.id });
        }
        answer += delta;
        const visible = stripDeltaMarkup(delta);
        if (visible) this.emit({ type: 'answer.delta', id: answerId, text: visible });
        if (answer.length > MAX_ANSWER_CHARS) break; // runaway guard
      }
      if (started && !this.closed) {
        const finalText = toPlainText(answer);
        this.emit({ type: 'answer.done', id: answerId, text: finalText });
        this.echo.rememberAnswer(finalText);
        this.deps.trace?.(`answered (${answer.trim().length} chars, forced=${forced})`);
        this.deps.debugText?.(`answer: ${finalText}`);
      }
    } catch (err) {
      this.deps.log?.(`answer failed: ${(err as Error).message}`);
      if (!this.closed) {
        const code = aiErrorCode(err);
        this.emit({
          type: 'answer.error',
          id: answerId,
          message: code ? 'AI is unavailable (provider quota exhausted)' : 'Could not generate an answer',
          ...(code ? { code } : {}),
        });
      }
    }
  }

  private async lookupMemory(text: string): Promise<MemoryFact[]> {
    if (!this.deps.memory) return [];
    try {
      return await this.deps.memory.findRelevant(this.ctx.userId, text, this.ctx.memoryFacts ?? 3);
    } catch (err) {
      // Memory is a nice-to-have: never let it block a real-time answer.
      this.deps.log?.(`memory lookup failed: ${(err as Error).message}`);
      return [];
    }
  }
}
