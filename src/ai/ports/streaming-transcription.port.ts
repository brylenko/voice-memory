import type { Readable } from 'stream';

export interface StreamingTranscriptionOptions {
  language?: string;
  /** 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' — tradeoff between latency and accuracy */
  latency?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

/**
 * Outbound port: real-time streaming transcription.
 * Takes a PCM audio stream, yields transcript text deltas as they arrive.
 * Swap adapter: OpenAI Realtime → self-hosted Whisper streaming → any other provider.
 */
export interface StreamingTranscriptionPort {
  transcribeStream(
    audioStream: Readable,
    options?: StreamingTranscriptionOptions,
  ): AsyncIterable<string>;
}

export const STREAMING_TRANSCRIPTION_PORT = Symbol('STREAMING_TRANSCRIPTION_PORT');
