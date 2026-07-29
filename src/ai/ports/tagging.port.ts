export interface TaggingResult {
  tags: string[];
  eventDate: Date | null;
}

export interface TaggingPort {
  extractTags(transcript: string, recordedAt: Date): Promise<TaggingResult>;
}

export const TAGGING_PORT = Symbol('TAGGING_PORT');
