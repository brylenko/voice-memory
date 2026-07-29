import { MigrationInterface, QueryRunner } from 'typeorm';

export class EncryptedFields1700000000012 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    // Convert summaries from jsonb to text so we can store encrypted ciphertext.
    // Existing plain-text JSON rows are cast to text — EncryptionService.decrypt()
    // gracefully handles non-encrypted values and returns them as-is.
    await qr.query(`
      ALTER TABLE audio_tracks
        ALTER COLUMN summaries TYPE TEXT USING summaries::text,
        ALTER COLUMN "fullText" TYPE TEXT
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE audio_tracks
        ALTER COLUMN summaries TYPE JSONB USING summaries::jsonb
    `);
  }
}
