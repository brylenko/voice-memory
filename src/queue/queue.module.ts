import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioTrackEntity } from '../audio-track/audio-track.entity';
import { AudioChunkEntity } from '../audio-chunk/audio-chunk.entity';
import { UserEntity } from '../user/user.entity';
import { AudioChunkRepository } from '../audio-chunk/audio-chunk.repository';
import { AudioProcessorProcessor } from './audio-processor.processor';
import { BackfillTasksCron } from './backfill-tasks.cron';
import { DailyBriefingCron } from './daily-briefing.cron';
import { NotificationModule } from '../notification/notification.module';
import { CommonModule } from '../common/common.module';
import { AiModule } from '../ai/ai.module';
import { BillingModule } from '../billing/billing.module';
import { AUDIO_RETRIEVAL_PORT } from './ports/audio-retrieval.port';
import { LocalDiskRetrievalAdapter } from './adapters/local-disk-retrieval.adapter';
import { S3RetrievalAdapter } from './adapters/s3-retrieval.adapter';
import { TelegramApiClient } from '../audio-ingest/adapters/inbound/telegram/telegram-api.client';
import { AUDIO_PROCESSING_QUEUE_PORT } from '../audio-ingest/application/ports/outbound/audio-processing-queue.port';
import { BullMqAudioQueueAdapter } from '../audio-ingest/adapters/outbound/queue/bullmq-audio-queue.adapter';
import { AUDIO_STORAGE_PORT } from '../audio-ingest/application/ports/outbound/audio-storage.port';
import { LocalDiskStorageAdapter } from '../audio-ingest/adapters/outbound/storage/local-disk-storage.adapter';
import { S3AudioStorageAdapter } from '../audio-ingest/adapters/outbound/storage/s3-audio-storage.adapter';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'audio-processing' }),
    TypeOrmModule.forFeature([AudioTrackEntity, AudioChunkEntity, UserEntity]),
    NotificationModule,
    CommonModule,
    AiModule,
    BillingModule,
  ],
  providers: [
    AudioProcessorProcessor,
    BackfillTasksCron,
    DailyBriefingCron,
    AudioChunkRepository,
    TelegramApiClient,
    LocalDiskRetrievalAdapter,
    S3RetrievalAdapter,
    LocalDiskStorageAdapter,
    S3AudioStorageAdapter,
    BullMqAudioQueueAdapter,
    { provide: AUDIO_PROCESSING_QUEUE_PORT, useExisting: BullMqAudioQueueAdapter },
    {
      provide: AUDIO_RETRIEVAL_PORT,
      inject: [ConfigService, LocalDiskRetrievalAdapter, S3RetrievalAdapter],
      useFactory: (config: ConfigService, local: LocalDiskRetrievalAdapter, s3: S3RetrievalAdapter) =>
        config.get<string>('storageDriver') === 's3' ? s3 : local,
    },
    {
      // Same STORAGE_DRIVER selection as AudioIngestModule — BackfillTasksCron
      // uses this to check S3 object existence during C2 abandoned-upload reconciliation.
      provide: AUDIO_STORAGE_PORT,
      inject: [ConfigService, LocalDiskStorageAdapter, S3AudioStorageAdapter],
      useFactory: (config: ConfigService, local: LocalDiskStorageAdapter, s3: S3AudioStorageAdapter) =>
        config.get<string>('storageDriver') === 's3' ? s3 : local,
    },
  ],
})
export class QueueModule {}
