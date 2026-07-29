import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TypeORM has no first-class "vector" column type, so the pgvector-backed
 * `audio_chunks.embedding` column is created here via raw SQL rather than through
 * entity `synchronize`. All reads/writes to that column also go through raw SQL
 * (see AudioChunkRepository / RagService) using the `::vector` cast and the
 * `<=>` cosine-distance operator.
 */
export class InitSchema1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audio_tracks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" VARCHAR NOT NULL,
        "deviceId" VARCHAR NULL,
        channel VARCHAR NOT NULL DEFAULT 'iot-device',
        status VARCHAR NOT NULL DEFAULT 'INITIALIZED',
        duration INTEGER NOT NULL DEFAULT 0,
        "fileUrl" VARCHAR NOT NULL,
        summary TEXT NULL,
        "batchJobId" VARCHAR NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audio_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "trackId" UUID NOT NULL REFERENCES audio_tracks(id) ON DELETE CASCADE,
        "userId" VARCHAR NOT NULL,
        text TEXT NOT NULL,
        embedding vector(1536) NOT NULL,
        "dayOfWeek" VARCHAR NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audio_chunks_user_created
      ON audio_chunks ("userId", "createdAt");
    `);

    // Approximate nearest-neighbour index for cosine distance search.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audio_chunks_embedding_cosine
      ON audio_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS audio_chunks;`);
    await queryRunner.query(`DROP TABLE IF EXISTS audio_tracks;`);
  }
}
