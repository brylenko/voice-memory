import type { TrackSummaries } from '../../audio-track/audio-track.entity';

export type SummaryTemplate =
  | 'meeting'
  | 'interview'
  | 'lecture'
  | 'sales_call'
  | 'custom';

/** Outbound port: synchronous multi-dimensional summarization. */
export interface SummarizationPort {
  summarize(fullText: string, template?: SummaryTemplate): Promise<TrackSummaries>;
}

export const SUMMARIZATION_PORT = Symbol('SUMMARIZATION_PORT');
