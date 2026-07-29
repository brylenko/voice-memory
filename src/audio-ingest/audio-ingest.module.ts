import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { AudioTrackEntity } from '../audio-track/audio-track.entity';
import { UserEntity } from '../user/user.entity';
import { BillingModule } from '../billing/billing.module';
import { RagModule } from '../rag/rag.module';

// application core
import { IngestAudioService } from './application/ingest-audio.service';
import { INGEST_AUDIO_USE_CASE } from './application/ports/inbound/ingest-audio.use-case';
import { RequestUploadService } from './application/request-upload.service';
import { REQUEST_UPLOAD_USE_CASE } from './application/ports/inbound/request-upload.use-case';
import { CompleteUploadService } from './application/complete-upload.service';
import { COMPLETE_UPLOAD_USE_CASE } from './application/ports/inbound/complete-upload.use-case';
import { AUDIO_METADATA_PORT } from './application/ports/outbound/audio-metadata.port';
import { AUDIO_STORAGE_PORT } from './application/ports/outbound/audio-storage.port';
import { AUDIO_TRACK_WRITER_PORT } from './application/ports/outbound/audio-track-writer.port';
import { AUDIO_PROCESSING_QUEUE_PORT } from './application/ports/outbound/audio-processing-queue.port';

// outbound adapters (driven)
import { MusicMetadataAdapter } from './adapters/outbound/metadata/music-metadata.adapter';
import { LocalDiskStorageAdapter } from './adapters/outbound/storage/local-disk-storage.adapter';
import { S3AudioStorageAdapter } from './adapters/outbound/storage/s3-audio-storage.adapter';
import { TypeOrmAudioTrackWriterAdapter } from './adapters/outbound/persistence/typeorm-audio-track-writer.adapter';
import { BullMqAudioQueueAdapter } from './adapters/outbound/queue/bullmq-audio-queue.adapter';

// inbound adapters (driving)
import { UploadController } from './adapters/inbound/http/upload.controller';
import { LocalUploadController } from './adapters/inbound/http/local-upload.controller';
import { DeviceAuthGuard } from './adapters/inbound/http/device-auth.guard';
import { TelegramWebhookController } from './adapters/inbound/telegram/telegram-webhook.controller';
import { TelegramWebhookGuard } from './adapters/inbound/telegram/telegram-webhook.guard';
import { TelegramApiClient } from './adapters/inbound/telegram/telegram-api.client';
import { TasksService } from './adapters/inbound/telegram/tasks.service';

/**
 * Composition root for the "ingest a recording" hexagon.
 *
 * To add a new input channel (WhatsApp, a browser recorder, ...):
 *   1. add a value to AudioSourceChannel
 *   2. write a new inbound adapter (controller/handler) that builds an
 *      IngestAudioCommand and calls INGEST_AUDIO_USE_CASE
 *   3. register it in `controllers` below
 * Nothing in application/* needs to change.
 *
 * To swap an outbound concern (e.g. disk -> S3 storage, mock -> real billing):
 *   change the `useClass` binding for that port below. Nothing else changes.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AudioTrackEntity, UserEntity]),
    BullModule.registerQueue({ name: 'audio-processing' }),
    BillingModule,
    RagModule,
  ],
  controllers: [UploadController, LocalUploadController, TelegramWebhookController],
  providers: [
    // driving (inbound) adapters' own dependencies
    DeviceAuthGuard,
    TelegramWebhookGuard,
    TelegramApiClient,
    TasksService,

    // application core
    { provide: INGEST_AUDIO_USE_CASE, useClass: IngestAudioService },
    { provide: REQUEST_UPLOAD_USE_CASE, useClass: RequestUploadService },
    { provide: COMPLETE_UPLOAD_USE_CASE, useClass: CompleteUploadService },

    // driven (outbound) adapters bound to their ports
    { provide: AUDIO_METADATA_PORT, useClass: MusicMetadataAdapter },
    LocalDiskStorageAdapter,
    S3AudioStorageAdapter,
    {
      // STORAGE_DRIVER=local|s3 picks which concrete adapter satisfies the port.
      // Both classes stay normal, fully-DI'd providers above; this factory just
      // chooses between two already-constructed instances.
      provide: AUDIO_STORAGE_PORT,
      inject: [ConfigService, LocalDiskStorageAdapter, S3AudioStorageAdapter],
      useFactory: (config: ConfigService, local: LocalDiskStorageAdapter, s3: S3AudioStorageAdapter) =>
        config.get<string>('storageDriver') === 's3' ? s3 : local,
    },
    { provide: AUDIO_TRACK_WRITER_PORT, useClass: TypeOrmAudioTrackWriterAdapter },
    { provide: AUDIO_PROCESSING_QUEUE_PORT, useClass: BullMqAudioQueueAdapter },
  ],
})
export class AudioIngestModule {}
