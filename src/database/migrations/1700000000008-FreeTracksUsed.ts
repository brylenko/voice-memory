import { MigrationInterface, QueryRunner } from 'typeorm';

export class FreeTracksUsed1700000000008 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS "freeTracksUsed" INTEGER NOT NULL DEFAULT 0;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE users DROP COLUMN IF EXISTS "freeTracksUsed";`);
  }
}
