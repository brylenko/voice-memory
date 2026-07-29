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
import { TrackNotFoundError } from './errors';

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

    await this.queue.enqueue({
      trackId: track.id,
      storageKey: track.fileUrl,
      userId: track.userId,
    });

    return { trackId: track.id, status: track.status };
  }
}
