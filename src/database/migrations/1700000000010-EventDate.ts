import { MigrationInterface, QueryRunner } from 'typeorm';

export class EventDate1700000000010 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE audio_tracks
        ADD COLUMN IF NOT EXISTS "eventDate" TIMESTAMPTZ
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE audio_tracks DROP COLUMN IF EXISTS "eventDate"`);
  }
}
