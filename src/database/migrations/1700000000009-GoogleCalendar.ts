import { MigrationInterface, QueryRunner } from 'typeorm';

export class GoogleCalendar1700000000009 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS "googleAccessToken"  TEXT,
        ADD COLUMN IF NOT EXISTS "googleRefreshToken" TEXT,
        ADD COLUMN IF NOT EXISTS "googleTokenExpiry"  TIMESTAMPTZ
    `);
    await qr.query(`
      ALTER TABLE audio_tracks
        ADD COLUMN IF NOT EXISTS "calendarEventId"  VARCHAR,
        ADD COLUMN IF NOT EXISTS "calendarEventTitle" VARCHAR
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE audio_tracks DROP COLUMN IF EXISTS "calendarEventTitle"`);
    await qr.query(`ALTER TABLE audio_tracks DROP COLUMN IF EXISTS "calendarEventId"`);
    await qr.query(`ALTER TABLE users DROP COLUMN IF EXISTS "googleTokenExpiry"`);
    await qr.query(`ALTER TABLE users DROP COLUMN IF EXISTS "googleRefreshToken"`);
    await qr.query(`ALTER TABLE users DROP COLUMN IF EXISTS "googleAccessToken"`);
  }
}
