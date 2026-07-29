import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserProfiles1700000000002 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Reference table: roles are data, not code
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id               SERIAL PRIMARY KEY,
        name             VARCHAR NOT NULL UNIQUE,
        label            VARCHAR NOT NULL,
        default_template VARCHAR NOT NULL
      )
    `);

    await queryRunner.query(`
      INSERT INTO user_roles (name, label, default_template) VALUES
        ('executive',  'Виконавець / Manager',  'meeting'),
        ('sales',      'Продажі / Sales',        'sales_call'),
        ('clinician',  'Лікар / Clinician',      'custom'),
        ('lawyer',     'Юрист / Lawyer',          'custom'),
        ('educator',   'Викладач / Educator',    'lecture'),
        ('creator',    'Контент-мейкер',          'custom'),
        ('other',      'Інше / Other',            'meeting')
      ON CONFLICT (name) DO NOTHING
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        "userId"          VARCHAR NOT NULL PRIMARY KEY,
        "roleId"          INT NULL REFERENCES user_roles(id),
        "defaultTemplate" VARCHAR NULL,
        "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_profiles`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_roles`);
  }
}
