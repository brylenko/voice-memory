export interface AudioProcessingJob {
  trackId: string;
  storageKey: string;
  userId: string;
  preTranscribedText?: string;
  detectedTemplate?: string;
}
