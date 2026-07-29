import { MigrationInterface, QueryRunner } from 'typeorm';

export class Users1700000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create canonical users table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "telegramId"  VARCHAR UNIQUE NULL,
        "displayName" VARCHAR NULL,
        "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Backfill: create a user row for each distinct userId (Telegram chat id)
    await queryRunner.query(`
      INSERT INTO users ("telegramId", "createdAt")
      SELECT DISTINCT "userId", MIN("createdAt")
      FROM audio_tracks
      GROUP BY "userId"
      ON CONFLICT ("telegramId") DO NOTHING
    `);

    // Add FK column to audio_tracks
    await queryRunner.query(`
      ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS "userIdFk" UUID NULL REFERENCES users(id)
    `);

    // Populate FK from the backfilled users
    await queryRunner.query(`
      UPDATE audio_tracks t
      SET "userIdFk" = u.id
      FROM users u
      WHERE u."telegramId" = t."userId"
    `);

    // Drop unused tables from the old onboarding design
    await queryRunner.query(`DROP TABLE IF EXISTS user_profiles`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_roles`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE audio_tracks DROP COLUMN IF EXISTS "userIdFk"`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
  }
}
