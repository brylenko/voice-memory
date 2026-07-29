export interface AudioMetadataInput {
  buffer: Buffer;
  /** Optional filename hint (helps format detection for some containers). */
  fileNameHint?: string;
}

/** Outbound port: figuring out how long a clip is. */
export interface AudioMetadataPort {
  getDurationSeconds(input: AudioMetadataInput): Promise<number>;
}

export const AUDIO_METADATA_PORT = Symbol('AUDIO_METADATA_PORT');
