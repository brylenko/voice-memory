/** Outbound port: audio bytes -> text. Swap OpenAI STT for local Whisper/faster-whisper freely. */
export interface TranscriptionPort {
  transcribe(audioBuffer: Buffer, fileNameHint?: string): Promise<string>;
}

export const TRANSCRIPTION_PORT = Symbol('TRANSCRIPTION_PORT');
