/** Raw audio format every SpeechSynthesisPort implementation produces. */
export const SPEECH_PCM_FORMAT = { encoding: 'pcm16le', sampleRate: 24_000, channels: 1 } as const;

/**
 * Outbound port: text → speech, streamed as PCM16 mono 24 kHz chunks so playback
 * can start before synthesis finishes (first audio in well under a second).
 */
export interface SpeechSynthesisPort {
  stream(text: string): AsyncIterable<Buffer>;
}

export const SPEECH_SYNTHESIS_PORT = Symbol('SPEECH_SYNTHESIS_PORT');
