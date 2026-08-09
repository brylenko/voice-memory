import { Inject, Injectable } from '@nestjs/common';
import {
  CompleteUploadCommand,
  CompleteUploadResult,
  CompleteUploadUseCase,
} from './ports/inbound/complete-upload.use-case';
import {
  AUDIO_TRACK_WRITER_PORT,
  AudioTrackWriterPort,
} from './ports/outbound/audio-track-writer.port';
import {
  AUDIO_PROCESSING_QUEUE_PORT,
  AudioProcessingQueuePort,
} from './ports/outbound/audio-processing-queue.port';
import { TrackAlreadyProcessingError, TrackNotFoundError, TrackOwnershipError } from './errors';
import { AudioTrackStatus } from '../../audio-track/audio-track.entity';

@Injectable()
export class CompleteUploadService implements CompleteUploadUseCase {
  constructor(
    @Inject(AUDIO_TRACK_WRITER_PORT) private readonly trackWriter: AudioTrackWriterPort,
    @Inject(AUDIO_PROCESSING_QUEUE_PORT) private readonly queue: AudioProcessingQueuePort,
  ) {}

  async execute(command: CompleteUploadCommand): Promise<CompleteUploadResult> {
    const track = await this.trackWriter.findById(command.trackId);
    if (!track) {
      throw new TrackNotFoundError(command.trackId);
    }

    if (track.userId !== command.userId) {
      throw new TrackOwnershipError(command.trackId);
    }

    // Guard against duplicate upload-complete calls (device retry, network replay).
    // PROCESSING/COMPLETED/FAILED tracks already have a job in flight or are done —
    // silently return current status so the device gets a valid response without
    // creating a second job that would produce duplicate embeddings.
    if (track.status !== AudioTrackStatus.INITIALIZED) {
      throw new TrackAlreadyProcessingError(command.trackId, track.status);
    }

    await this.queue.enqueue({
      trackId: track.id,
      storageKey: track.fileUrl,
      userId: track.userId,
    });

    return { trackId: track.id, status: track.status };
  }
}
