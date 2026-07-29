import type { AudioTrackEntity } from '../../../../audio-track/audio-track.entity';

/**
 * A "channel" is whichever inbound adapter produced the recording. Adding a new
 * ingestion source (WhatsApp, a web recorder, etc.) means adding a new value
 * here plus a new inbound adapter — nothing in the application core changes.
 */
export type AudioSourceChannel = 'iot-device' | 'telegram';

export interface CreateTrackInput {
  userId: string;
  channel: AudioSourceChannel;
  storageKey: string;
  duration: number;
  telegramChatId?: string;
  telegramMessageId?: number;
}

/** Outbound port: persisting and reading back the AudioTrack aggregate. */
export interface AudioTrackWriterPort {
  createInitialized(input: CreateTrackInput): Promise<AudioTrackEntity>;
  findById(trackId: string): Promise<AudioTrackEntity | null>;
}

export const AUDIO_TRACK_WRITER_PORT = Symbol('AUDIO_TRACK_WRITER_PORT');
