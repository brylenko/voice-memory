import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DayOfWeek } from './audio-chunk.entity';

export interface InsertChunkInput {
  trackId: string;
  userId: string;
  text: string;
  embedding: number[];
  dayOfWeek: DayOfWeek;
  createdAt: Date;
}

export interface SimilaritySearchResult {
  id: string;
  trackId: string;
  text: string;
  dayOfWeek: string;
  createdAt: Date;
  distance: number;
}

/**
 * Thin repository wrapping the raw SQL needed for pgvector, since TypeORM's
 * query builder does not understand the `vector` type or the `<=>` operator.
 * Single Responsibility: this is the ONLY place that talks pgvector-SQL.
 */
@Injectable()
export class AudioChunkRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Atomically replaces all chunks for a track.
   *
   * trackId is explicit so the DELETE runs even when chunks is empty —
   * a retry that produces zero embeddings must not leave stale rows behind.
   *
   * Concurrent correctness: pg_advisory_xact_lock serialises concurrent workers
   * on the same trackId. The lock is scoped to the transaction and released
   * automatically on commit/rollback — no manual unlock needed.
   */
  async replaceChunks(trackId: string, chunks: InsertChunkInput[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // Advisory lock keyed on trackId hash — serialises concurrent workers for
      // the same track without blocking unrelated tracks.
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [trackId],
      );

      await manager.query(`DELETE FROM audio_chunks WHERE "trackId" = $1`, [trackId]);

      for (const chunk of chunks) {
        await manager.query(
          `INSERT INTO audio_chunks
             ("trackId", "userId", text, embedding, "dayOfWeek", "createdAt")
           VALUES ($1, $2, $3, $4::vector, $5, $6)`,
          [
            chunk.trackId,
            chunk.userId,
            chunk.text,
            `[${chunk.embedding.join(',')}]`,
            chunk.dayOfWeek,
            chunk.createdAt,
          ],
        );
      }
    });
  }

  /** @deprecated Use replaceChunks(trackId, chunks) for idempotent upsert. */
  async insertMany(chunks: InsertChunkInput[]): Promise<void> {
    if (chunks.length === 0) return;
    return this.replaceChunks(chunks[0].trackId, chunks);
  }

  /**
   * Filters by userId + a calendar window, then ranks by cosine distance
   * (`<=>`, provided by pgvector) against the query embedding. Lower distance = closer.
   */
  async searchTopK(params: {
    userId: string;
    startDate: string; // 'YYYY-MM-DD'
    endDate: string; // 'YYYY-MM-DD'
    queryEmbedding: number[];
    topK?: number;
  }): Promise<SimilaritySearchResult[]> {
    const { userId, startDate, endDate, queryEmbedding, topK = 5 } = params;

    const rows = await this.dataSource.query(
      `SELECT
         id,
         "trackId"   AS "trackId",
         text,
         "dayOfWeek" AS "dayOfWeek",
         "createdAt" AS "createdAt",
         embedding <=> $1::vector AS distance
       FROM audio_chunks
       WHERE "userId" = $2
         AND "createdAt" >= $3::date
         AND "createdAt" <  ($4::date + INTERVAL '1 day')
       ORDER BY distance ASC
       LIMIT $5`,
      [`[${queryEmbedding.join(',')}]`, userId, startDate, endDate, topK],
    );

    return rows as SimilaritySearchResult[];
  }
}
