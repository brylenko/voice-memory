import type { MemoryFact } from './memory-context.port';

export interface MemoryRecall {
  facts: MemoryFact[];
  /** Calendar window the search was limited to (from the question: "yesterday", "this week"...). */
  window?: { startDate: string; endDate: string };
  /** Short recap of the whole day (for "what did I hear today?"). */
  daySummary?: string | null;
}

/**
 * Outbound port: answer-from-memory retrieval for explicit questions about the
 * user's own past conversations (date-aware, unlike MemoryContextPort's
 * opportunistic similarity lookup).
 */
export interface MemoryRecallPort {
  recall(userId: string, request: string, opts: { includeDay: boolean; tzOffsetMinutes: number }): Promise<MemoryRecall>;
}

export const MEMORY_RECALL_PORT = Symbol('MEMORY_RECALL_PORT');
