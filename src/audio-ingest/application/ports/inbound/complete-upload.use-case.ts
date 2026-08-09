export interface CompleteUploadCommand {
  trackId: string;
  /** The authenticated user requesting completion — must match track.userId. */
  userId: string;
}

export interface CompleteUploadResult {
  trackId: string;
  status: string;
}

/**
 * Inbound port, phase 2 of 2: the client calls this once its direct upload to
 * storage has finished. All this does is enqueue processing — the actual file
 * existence is verified implicitly when AudioProcessorProcessor tries to
 * download it (see README: known tradeoff vs. a dedicated HEAD-object check).
 */
export interface CompleteUploadUseCase {
  execute(command: CompleteUploadCommand): Promise<CompleteUploadResult>;
}

export const COMPLETE_UPLOAD_USE_CASE = Symbol('COMPLETE_UPLOAD_USE_CASE');
