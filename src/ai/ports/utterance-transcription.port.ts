import type { Readable } from 'stream';

/**
 * Events produced while transcribing a continuous audio stream that is split
 * into utterances (speech turns) by voice-activity detection.
 *
 *  - `partial` — in-progress text of the current utterance (UI feedback only)
 *  - `final`   — a complete utterance; this is what downstream logic acts on
 */
export type UtteranceEvent =
  | { type: 'partial'; utteranceId: string; text: string }
  | { type: 'final'; utteranceId: string; text: string };

export interface UtteranceTranscriptionOptions {
  language?: string;
  /** Silence (ms) that closes an utterance. Lower = snappier, higher = fewer split sentences. */
  silenceMs?: number;
}

/**
 * Outbound port for always-on listening: unlike StreamingTranscriptionPort
 * (one long transcript per session), this one segments speech into turns so
 * the caller can react to each sentence in real time.
 */
export interface UtteranceTranscriptionPort {
  transcribeUtterances(
    audioStream: Readable,
    options?: UtteranceTranscriptionOptions,
  ): AsyncIterable<UtteranceEvent>;
}

export const UTTERANCE_TRANSCRIPTION_PORT = Symbol('UTTERANCE_TRANSCRIPTION_PORT');
