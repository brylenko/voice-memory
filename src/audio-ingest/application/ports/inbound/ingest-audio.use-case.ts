import type { AudioSourceChannel } from '../outbound/audio-track-writer.port';

export interface IngestAudioCommand {
  userId: string;
  channel: AudioSourceChannel;
  audioBuffer: Buffer;
  suggestedFileName: string;
  /**
   * Set this when the inbound adapter already knows the duration (e.g. Telegram
   * voice notes report it natively) to skip re-probing the file.
   */
  knownDurationSeconds?: number;
  /** For telegram channel: chat id to send the summary back once processing completes. */
  telegramChatId?: string;
  /** Telegram message_id of the original voice message — used to reply with the summary. */
  telegramMessageId?: number;
  /** When the inbound adapter already transcribed the audio (e.g. for intent classification), pass it here to skip re-transcription in the processor. */
  preTranscribedText?: string;
  /** Auto-detected recording type; overrides the user's profile default template for this track. */
  detectedTemplate?: string;
}

export interface IngestAudioResult {
  trackId: string;
  status: string;
}

/**
 * Inbound port ("driving" port): the single use case every channel-specific
 * adapter (HTTP device upload, Telegram bot, future channels...) calls into.
 * Adapters know nothing about balances, storage, or queues — only this contract.
 */
export interface IngestAudioUseCase {
  execute(command: IngestAudioCommand): Promise<IngestAudioResult>;
}

export const INGEST_AUDIO_USE_CASE = Symbol('INGEST_AUDIO_USE_CASE');
