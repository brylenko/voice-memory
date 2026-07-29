import type { Readable } from 'stream';

export enum TranscriptionLatency {
  Minimal = 'minimal',
  Low     = 'low',
  Medium  = 'medium',
  High    = 'high',
  XHigh   = 'xhigh',
}

export interface StreamingTranscriptionOptions {
  language?: string;
  latency?: TranscriptionLatency;
}

export interface StreamingTranscriptionPort {
  transcribeStream(
    audioStream: Readable,
    options?: StreamingTranscriptionOptions,
  ): AsyncIterable<string>;
}

export const STREAMING_TRANSCRIPTION_PORT = Symbol('STREAMING_TRANSCRIPTION_PORT');
