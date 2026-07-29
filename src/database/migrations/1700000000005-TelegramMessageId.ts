import { MigrationInterface, QueryRunner } from 'typeorm';

export class TelegramMessageId1700000000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE audio_tracks
        ADD COLUMN IF NOT EXISTS "telegramMessageId" INTEGER NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE audio_tracks DROP COLUMN IF EXISTS "telegramMessageId"
    `);
  }
}
