import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiService } from './services/openai.service';
import { S3_CLIENT, createS3Client } from './services/s3-client.provider';
import { TelegramApiClient } from '../audio-ingest/adapters/inbound/telegram/telegram-api.client';
import { EncryptionService } from './services/encryption.service';

/**
 * Global module exposing cross-cutting, stateless services (OpenAI client,
 * shared S3 client, Telegram bot client, field encryption) so feature modules
 * don't need to re-import them.
 */
@Global()
@Module({
  providers: [
    OpenAiService,
    TelegramApiClient,
    EncryptionService,
    { provide: S3_CLIENT, inject: [ConfigService], useFactory: createS3Client },
  ],
  exports: [OpenAiService, TelegramApiClient, EncryptionService, S3_CLIENT],
})
export class CommonModule {}
