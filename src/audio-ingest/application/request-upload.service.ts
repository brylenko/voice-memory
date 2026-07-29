import { Inject, Injectable } from '@nestjs/common';
import {
  RequestUploadCommand,
  RequestUploadResult,
  RequestUploadUseCase,
} from './ports/inbound/request-upload.use-case';
import { BALANCE_CHECKER_PORT, BalanceCheckerPort } from '../../billing/ports/balance-checker.port';
import { AUDIO_STORAGE_PORT, AudioStoragePort } from './ports/outbound/audio-storage.port';
import {
  AUDIO_TRACK_WRITER_PORT,
  AudioTrackWriterPort,
} from './ports/outbound/audio-track-writer.port';
import { InsufficientBalanceError } from './errors';

/**
 * Phase 1 of the direct-to-storage upload flow. Deliberately tiny and fast —
 * one balance check, one presign call, one DB insert — because this is the
 * endpoint 100 concurrent clients hit at once; none of them touch audio bytes
 * here, so there's nothing here that scales worse under concurrency than a
 * plain DB write does.
 */
@Injectable()
export class RequestUploadService implements RequestUploadUseCase {
  constructor(
    @Inject(BALANCE_CHECKER_PORT) private readonly balance: BalanceCheckerPort,
    @Inject(AUDIO_STORAGE_PORT) private readonly storage: AudioStoragePort,
    @Inject(AUDIO_TRACK_WRITER_PORT) private readonly trackWriter: AudioTrackWriterPort,
  ) {}

  async execute(command: RequestUploadCommand): Promise<RequestUploadResult> {
    const requiredMinutes = Math.ceil(command.durationSeconds / 60);
    const remainingMinutes = await this.balance.getRemainingMinutes(command.userId);
    if (remainingMinutes < requiredMinutes) {
      throw new InsufficientBalanceError(requiredMinutes, remainingMinutes);
    }

    const presigned = await this.storage.createUploadUrl(command.suggestedFileName, command.userId);

    const track = await this.trackWriter.createInitialized({
      userId: command.userId,
      channel: command.channel,
      storageKey: presigned.storageKey,
      duration: command.durationSeconds,
    });

    return {
      trackId: track.id,
      uploadUrl: presigned.uploadUrl,
      expiresInSeconds: presigned.expiresInSeconds,
    };
  }
}
