import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import configuration from './config/configuration';
import { AudioTrackEntity } from './audio-track/audio-track.entity';
import { AudioChunkEntity } from './audio-chunk/audio-chunk.entity';
import { UserEntity } from './user/user.entity';
import { AudioIngestModule } from './audio-ingest/audio-ingest.module';
import { QueueModule } from './queue/queue.module';
import { RagModule } from './rag/rag.module';
import { NotificationModule } from './notification/notification.module';
import { CommonModule } from './common/common.module';
import { AiModule } from './ai/ai.module';
import { BillingModule } from './billing/billing.module';
import { StreamingModule } from './streaming/streaming.module';
import { HealthController } from './health/health.controller';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('db.host'),
        port: config.get('db.port'),
        username: config.get('db.username'),
        password: config.get('db.password'),
        database: config.get('db.database'),
        entities: [AudioTrackEntity, AudioChunkEntity, UserEntity],
        // Schema for audio_tracks/audio_chunks is managed by the migration in
        // src/database/migrations (needed for the raw pgvector column/index) —
        // keep synchronize off to avoid TypeORM fighting that migration.
        synchronize: false,
        migrations: ['dist/database/migrations/*.js'],
        env: config.get('env'),
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('redis.host'),
          port: config.get('redis.port'),
        },
      }),
    }),
    ScheduleModule.forRoot(),
    CommonModule,
    AiModule,
    BillingModule,
    StreamingModule,
    NotificationModule,
    AudioIngestModule,
    QueueModule,
    RagModule,
  ],
})
export class AppModule {}
