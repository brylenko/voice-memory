import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import {
  AudioProcessingQueuePort,
  EnqueueAudioProcessingInput,
} from '../../../application/ports/outbound/audio-processing-queue.port';
import type { AudioProcessingJob } from '../../../../queue/audio-processing-job.interface';

@Injectable()
export class BullMqAudioQueueAdapter implements AudioProcessingQueuePort {
  constructor(
    @InjectQueue('audio-processing') private readonly queue: Queue<AudioProcessingJob>,
  ) {}

  async enqueue(input: EnqueueAudioProcessingInput): Promise<void> {
    await this.queue.add(
      'process-audio-track',
      { trackId: input.trackId, storageKey: input.storageKey, userId: input.userId, preTranscribedText: input.preTranscribedText, detectedTemplate: input.detectedTemplate },
      {
        // jobId=trackId makes enqueue idempotent under concurrent upload-complete calls:
        // BullMQ silently ignores duplicate adds with the same jobId while the job is
        // still waiting or active.
        jobId: input.trackId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: true,
        removeOnFail: false, // retain failed jobs in Redis for inspection
      },
    );
  }
}
