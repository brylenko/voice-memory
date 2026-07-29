export interface TaggingPort {
  extractTags(transcript: string): Promise<string[]>;
}

export const TAGGING_PORT = Symbol('TAGGING_PORT');
