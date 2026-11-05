export interface MemoryFact {
  text: string;
  heardAt: Date;
}

/**
 * Outbound port: "what do I already remember that is relevant to this?" —
 * lets the live assistant ground answers in what the watch heard earlier
 * (all-day memory mode) without knowing about pgvector or embeddings.
 */
export interface MemoryContextPort {
  findRelevant(userId: string, text: string, limit: number): Promise<MemoryFact[]>;
}

export const MEMORY_CONTEXT_PORT = Symbol('MEMORY_CONTEXT_PORT');
