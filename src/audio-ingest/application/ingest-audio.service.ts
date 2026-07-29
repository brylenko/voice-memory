import { Inject, Injectable } from '@nestjs/common';
import {
  IngestAudioCommand,
  IngestAudioResult,
  IngestAudioUseCase,
} from './ports/inbound/ingest-audio.use-case';
import { AUDIO_METADATA_PORT, AudioMetadataPort } from './ports/outbound/audio-metadata.port';
import { BALANCE_CHECKER_PORT, BalanceCheckerPort } from '../../billing/ports/balance-checker.port';
import { AUDIO_STORAGE_PORT, AudioStoragePort } from './ports/outbound/audio-storage.port';
import {
  AUDIO_TRACK_WRITER_PORT,
  AudioTrackWriterPort,
} from './ports/outbound/audio-track-writer.port';
import {
  AUDIO_PROCESSING_QUEUE_PORT,
  AudioProcessingQueuePort,
} from './ports/outbound/audio-processing-queue.port';
import { InsufficientBalanceError } from './errors';

/**
 * The hexagon's core. Contains 100% of the "ingest a recording" business rules
 * and touches zero framework/transport/storage-vendor specifics — everything
 * external is reached through the outbound ports injected here, and this class
 * is itself only ever reached through the IngestAudioUseCase port, never
 * instantiated directly by an adapter.
 */
@Injectable()
export class IngestAudioService implements IngestAudioUseCase {
  constructor(
    @Inject(AUDIO_METADATA_PORT) private readonly metadata: AudioMetadataPort,
    @Inject(BALANCE_CHECKER_PORT) private readonly balance: BalanceCheckerPort,
    @Inject(AUDIO_STORAGE_PORT) private readonly storage: AudioStoragePort,
    @Inject(AUDIO_TRACK_WRITER_PORT) private readonly trackWriter: AudioTrackWriterPort,
    @Inject(AUDIO_PROCESSING_QUEUE_PORT) private readonly queue: AudioProcessingQueuePort,
  ) {}

  async execute(command: IngestAudioCommand): Promise<IngestAudioResult> {
    const durationSeconds =
      command.knownDurationSeconds ??
      (await this.metadata.getDurationSeconds({
        buffer: command.audioBuffer,
        fileNameHint: command.suggestedFileName,
      }));

    const requiredMinutes = Math.ceil(durationSeconds / 60);
    const remainingMinutes = await this.balance.getRemainingMinutes(command.userId);
    if (remainingMinutes < requiredMinutes) {
      throw new InsufficientBalanceError(requiredMinutes, remainingMinutes);
    }

    const stored = await this.storage.save({
      buffer: command.audioBuffer,
      suggestedName: command.suggestedFileName,
      userId: command.userId,
    });

    const track = await this.trackWriter.createInitialized({
      userId: command.userId,
      channel: command.channel,
      storageKey: stored.storageKey,
      duration: durationSeconds,
      telegramChatId: command.telegramChatId,
      telegramMessageId: command.telegramMessageId,
    });

    // Hand off to async AI processing; HTTP/Telegram response goes back immediately.
    await this.queue.enqueue({
      trackId: track.id,
      storageKey: stored.storageKey,
      userId: command.userId,
      preTranscribedText: command.preTranscribedText,
      detectedTemplate: command.detectedTemplate,
    });

    return { trackId: track.id, status: track.status };
  }
}
