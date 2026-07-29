import 'dotenv/config';
import { DataSource } from 'typeorm';
import { AudioTrackEntity } from './audio-track/audio-track.entity';
import { AudioChunkEntity } from './audio-chunk/audio-chunk.entity';
import { UserEntity } from './user/user.entity';

/**
 * Standalone TypeORM DataSource, separate from AppModule's TypeOrmModule.forRootAsync
 * (which goes through Nest's ConfigService/DI). This one exists purely so migrations
 * can run outside the Nest application context — from the CLI or, in Docker, as a
 * one-shot step before the server starts (see Dockerfile CMD).
 */
export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USER ?? 'plaud',
  password: process.env.DB_PASSWORD ?? 'plaud',
  database: process.env.DB_NAME ?? 'plaud',
  entities: [AudioTrackEntity, AudioChunkEntity, UserEntity],
  migrations: ['dist/database/migrations/*.js'],
});
