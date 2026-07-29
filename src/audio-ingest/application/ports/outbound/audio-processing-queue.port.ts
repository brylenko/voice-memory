export interface EnqueueAudioProcessingInput {
  trackId: string;
  storageKey: string;
  userId: string;
  preTranscribedText?: string;
  detectedTemplate?: string;
}

/** Outbound port: handing the track off for async AI processing. */
export interface AudioProcessingQueuePort {
  enqueue(input: EnqueueAudioProcessingInput): Promise<void>;
}

export const AUDIO_PROCESSING_QUEUE_PORT = Symbol('AUDIO_PROCESSING_QUEUE_PORT');
