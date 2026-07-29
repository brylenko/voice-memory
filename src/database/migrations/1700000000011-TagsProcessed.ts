import { MigrationInterface, QueryRunner } from 'typeorm';

export class TagsProcessed1700000000011 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE audio_tracks
        ADD COLUMN IF NOT EXISTS "tagsProcessed" BOOLEAN NOT NULL DEFAULT FALSE
    `);
    // Mark existing tracks with non-empty tags as already processed
    await qr.query(`
      UPDATE audio_tracks SET "tagsProcessed" = TRUE WHERE tags != '{}'
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE audio_tracks DROP COLUMN IF EXISTS "tagsProcessed"`);
  }
}
