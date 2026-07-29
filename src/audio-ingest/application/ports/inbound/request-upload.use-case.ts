import type { AudioSourceChannel } from '../outbound/audio-track-writer.port';

export interface RequestUploadCommand {
  userId: string;
  channel: AudioSourceChannel;
  /**
   * The client (device) reports its own recorded duration up front — with a
   * direct-to-storage upload our server never sees the bytes at request time,
   * so it can't independently measure duration the way the old single-shot
   * flow did. AudioProcessorProcessor re-measures the real duration once it
   * downloads the file for STT and can flag/reconcile mismatches later; see
   * README for the tradeoff this implies.
   */
  durationSeconds: number;
  suggestedFileName: string;
}

export interface RequestUploadResult {
  trackId: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

/**
 * Inbound port, phase 1 of 2: authorize an upload and hand back somewhere to
 * PUT bytes directly (S3 presigned URL in prod). Does NOT touch the audio
 * itself — that's the whole point, so N concurrent requests cost us nothing
 * beyond one balance check + one DB insert + one presign call each.
 */
export interface RequestUploadUseCase {
  execute(command: RequestUploadCommand): Promise<RequestUploadResult>;
}

export const REQUEST_UPLOAD_USE_CASE = Symbol('REQUEST_UPLOAD_USE_CASE');
