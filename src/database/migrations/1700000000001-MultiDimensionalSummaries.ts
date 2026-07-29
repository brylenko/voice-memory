import { MigrationInterface, QueryRunner } from 'typeorm';

export class MultiDimensionalSummaries1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS summaries JSONB NULL;`);
    await queryRunner.query(`ALTER TABLE audio_tracks DROP COLUMN IF EXISTS summary;`);
    await queryRunner.query(`ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS "telegramChatId" VARCHAR NULL;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS summary TEXT NULL;`);
    await queryRunner.query(`ALTER TABLE audio_tracks DROP COLUMN IF EXISTS summaries;`);
    await queryRunner.query(`ALTER TABLE audio_tracks DROP COLUMN IF EXISTS "telegramChatId";`);
  }
}
