/**
 * Outbound port: text -> vector(s). Same model MUST be used for indexing
 * chunks and embedding search queries (see AudioChunkRepository) — that
 * invariant lives at the call sites, this port just hides which model/vendor
 * actually runs. Swap OpenAI for a local model (e.g. BGE-M3) by rebinding.
 */
export interface EmbeddingPort {
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_PORT = Symbol('EMBEDDING_PORT');
