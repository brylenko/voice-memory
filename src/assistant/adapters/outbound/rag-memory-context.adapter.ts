import { Inject, Injectable } from '@nestjs/common';
import { EMBEDDING_PORT, EmbeddingPort } from '../../../ai/ports/embedding.port';
import { AudioChunkRepository } from '../../../audio-chunk/audio-chunk.repository';
import type { MemoryContextPort, MemoryFact } from '../../application/ports/memory-context.port';

/** Cosine distance above which a chunk is considered unrelated noise. */
const MAX_DISTANCE = 0.6;
const LOOKBACK_DAYS = 365;

/** MemoryContextPort backed by the same pgvector index RAG search uses. */
@Injectable()
export class RagMemoryContextAdapter implements MemoryContextPort {
  constructor(
    @Inject(EMBEDDING_PORT) private readonly embedding: EmbeddingPort,
    private readonly chunks: AudioChunkRepository,
  ) {}

  async findRelevant(userId: string, text: string, limit: number): Promise<MemoryFact[]> {
    const [queryEmbedding] = await this.embedding.embed([text]);
    const today = new Date();
    const from = new Date(today.getTime() - LOOKBACK_DAYS * 86_400_000);

    const rows = await this.chunks.searchTopK({
      userId,
      startDate: from.toISOString().slice(0, 10),
      endDate: today.toISOString().slice(0, 10),
      queryEmbedding,
      topK: limit,
    });

    return rows
      .filter((r) => Number(r.distance) <= MAX_DISTANCE)
      .map((r) => ({ text: r.text, heardAt: new Date(r.createdAt) }));
  }
}
