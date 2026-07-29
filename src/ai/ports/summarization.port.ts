import type { TrackSummaries } from '../../audio-track/audio-track.entity';

export enum SummaryTemplate {
  Meeting   = 'meeting',
  Interview = 'interview',
  Lecture   = 'lecture',
  SalesCall = 'sales_call',
  Custom    = 'custom',
}

export interface SummarizationPort {
  summarize(fullText: string, template?: SummaryTemplate): Promise<TrackSummaries>;
}

export const SUMMARIZATION_PORT = Symbol('SUMMARIZATION_PORT');
