import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replaces the legacy VARCHAR userId columns (Telegram chat ID) in audio_tracks
 * and audio_chunks with proper UUID foreign keys pointing to users.id.
 *
 * Before: audio_tracks.userId = '123456789'  (Telegram string)
 *         audio_tracks.userIdFk = uuid        (FK, added in migration 004)
 * After:  audio_tracks.userId = uuid          (single FK column, renamed from userIdFk)
 *         audio_tracks.userIdFk dropped
 *
 * Same pattern for audio_chunks.
 */
export class NormalizeUserIdToUuid1700000000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── audio_tracks ──────────────────────────────────────────────────────────

    // 1. Backfill any rows that still have a NULL userIdFk (shouldn't happen
    //    after migration 004, but guard anyway).
    await queryRunner.query(`
      UPDATE audio_tracks t
      SET "userIdFk" = u.id
      FROM users u
      WHERE u."telegramId" = t."userId"
        AND t."userIdFk" IS NULL
    `);

    // 2. Drop the old VARCHAR column and rename the FK column to userId.
    await queryRunner.query(`ALTER TABLE audio_tracks DROP COLUMN "userId"`);
    await queryRunner.query(`ALTER TABLE audio_tracks RENAME COLUMN "userIdFk" TO "userId"`);

    // 3. Add NOT NULL constraint now that every row is populated.
    await queryRunner.query(`ALTER TABLE audio_tracks ALTER COLUMN "userId" SET NOT NULL`);

    // 4. Add FK constraint (the column existed as nullable before, without a named constraint).
    await queryRunner.query(`
      ALTER TABLE audio_tracks
        ADD CONSTRAINT fk_audio_tracks_user
        FOREIGN KEY ("userId") REFERENCES users(id)
    `);

    // ── audio_chunks ──────────────────────────────────────────────────────────

    // 5. Add a UUID column for the new FK.
    await queryRunner.query(`ALTER TABLE audio_chunks ADD COLUMN "userIdFk" UUID NULL`);

    // 6. Populate it by joining through audio_tracks (chunks inherit the same user).
    await queryRunner.query(`
      UPDATE audio_chunks c
      SET "userIdFk" = t."userId"
      FROM audio_tracks t
      WHERE t.id = c."trackId"
    `);

    // 7. Drop old VARCHAR, rename, add NOT NULL + FK.
    await queryRunner.query(`ALTER TABLE audio_chunks DROP COLUMN "userId"`);
    await queryRunner.query(`ALTER TABLE audio_chunks RENAME COLUMN "userIdFk" TO "userId"`);
    await queryRunner.query(`ALTER TABLE audio_chunks ALTER COLUMN "userId" SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE audio_chunks
        ADD CONSTRAINT fk_audio_chunks_user
        FOREIGN KEY ("userId") REFERENCES users(id)
    `);

    // 8. Recreate the index (was on VARCHAR, now on UUID).
    await queryRunner.query(`DROP INDEX IF EXISTS idx_audio_chunks_user_created`);
    await queryRunner.query(`
      CREATE INDEX idx_audio_chunks_user_created ON audio_chunks ("userId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse audio_chunks
    await queryRunner.query(`ALTER TABLE audio_chunks DROP CONSTRAINT IF EXISTS fk_audio_chunks_user`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_audio_chunks_user_created`);
    await queryRunner.query(`ALTER TABLE audio_chunks ADD COLUMN "userIdOld" VARCHAR`);
    await queryRunner.query(`
      UPDATE audio_chunks c
      SET "userIdOld" = u."telegramId"
      FROM users u
      WHERE u.id = c."userId"
    `);
    await queryRunner.query(`ALTER TABLE audio_chunks DROP COLUMN "userId"`);
    await queryRunner.query(`ALTER TABLE audio_chunks RENAME COLUMN "userIdOld" TO "userId"`);
    await queryRunner.query(`ALTER TABLE audio_chunks ALTER COLUMN "userId" SET NOT NULL`);
    await queryRunner.query(`
      CREATE INDEX idx_audio_chunks_user_created ON audio_chunks ("userId", "createdAt")
    `);

    // Reverse audio_tracks
    await queryRunner.query(`ALTER TABLE audio_tracks DROP CONSTRAINT IF EXISTS fk_audio_tracks_user`);
    await queryRunner.query(`ALTER TABLE audio_tracks ADD COLUMN "userIdFk" UUID`);
    await queryRunner.query(`UPDATE audio_tracks SET "userIdFk" = "userId"`);
    await queryRunner.query(`ALTER TABLE audio_tracks ADD COLUMN "userIdOld" VARCHAR`);
    await queryRunner.query(`
      UPDATE audio_tracks t
      SET "userIdOld" = u."telegramId"
      FROM users u
      WHERE u.id = t."userId"
    `);
    await queryRunner.query(`ALTER TABLE audio_tracks DROP COLUMN "userId"`);
    await queryRunner.query(`ALTER TABLE audio_tracks RENAME COLUMN "userIdOld" TO "userId"`);
    await queryRunner.query(`ALTER TABLE audio_tracks ALTER COLUMN "userId" SET NOT NULL`);
  }
}
