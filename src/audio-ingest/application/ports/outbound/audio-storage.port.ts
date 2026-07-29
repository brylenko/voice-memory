export interface StoredAudioFile {
  /** Internal key the worker uses to fetch the file (local path today, S3 key tomorrow). */
  storageKey: string;
  /** URL that can be handed back to a client. */
  publicUrl: string;
}

export interface SaveAudioInput {
  buffer: Buffer;
  suggestedName: string;
  userId: string;
}

export interface PresignedUpload {
  /** Same key `save()` would have produced — worker reads it back with this. */
  storageKey: string;
  /** Where the CLIENT (not our server) should PUT the raw audio bytes. */
  uploadUrl: string;
  /** URL that can be handed back once the recording is processed. */
  publicUrl: string;
  expiresInSeconds: number;
}

/** Outbound port: where raw audio bytes are persisted. Swap disk <-> S3 <-> GCS freely. */
export interface AudioStoragePort {
  /** Server-side save — used when we already hold the bytes (e.g. downloaded from Telegram). */
  save(input: SaveAudioInput): Promise<StoredAudioFile>;

  /**
   * Client-side upload — used when the client should send bytes directly to
   * storage instead of through our server (avoids buffering large files in our
   * process's memory and avoids paying our own egress for the upload).
   */
  createUploadUrl(suggestedName: string, userId: string): Promise<PresignedUpload>;
}

export const AUDIO_STORAGE_PORT = Symbol('AUDIO_STORAGE_PORT');
