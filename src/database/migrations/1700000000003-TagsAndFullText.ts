import { MigrationInterface, QueryRunner } from 'typeorm';

export class TagsAndFullText1700000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Tags: stored as a simple text array on audio_tracks
    await queryRunner.query(`
      ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
    `);

    // Full-text search: tsvector column populated from transcript chunks
    // We store a per-track tsvector built from the full transcript text.
    await queryRunner.query(`
      ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS "fullText" TEXT NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS "searchVector" TSVECTOR NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audio_tracks_search_vector
      ON audio_tracks USING GIN ("searchVector");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audio_tracks_tags
      ON audio_tracks USING GIN (tags);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE audio_tracks DROP COLUMN IF EXISTS tags;`);
    await queryRunner.query(`ALTER TABLE audio_tracks DROP COLUMN IF EXISTS "fullText";`);
    await queryRunner.query(`ALTER TABLE audio_tracks DROP COLUMN IF EXISTS "searchVector";`);
  }
}
