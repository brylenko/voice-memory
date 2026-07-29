import type { TrackSummaries } from '../../audio-track/audio-track.entity';

export enum SummaryTemplate {
  Meeting   = 'meeting',
  Interview = 'interview',
  Lecture   = 'lecture',
  SalesCall = 'sales_call',
  Custom    = 'custom',
}

export interface SummarizationResult {
  summaries: TrackSummaries;
  tags: string[];
  eventDate: Date | null;
}

export interface SummarizationPort {
  summarize(fullText: string, template: SummaryTemplate, recordedAt: Date): Promise<SummarizationResult>;
}

export const SUMMARIZATION_PORT = Symbol('SUMMARIZATION_PORT');
