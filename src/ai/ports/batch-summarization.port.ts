import { TrackSummaries } from '../../audio-track/audio-track.entity';

export type BatchSummaryStatus = 'in_progress' | 'completed' | 'failed';

export interface BatchSummaryCheckResult {
  status: BatchSummaryStatus;
  /** Present only when status === 'completed'. */
  summaries?: TrackSummaries;
}

/**
 * Outbound port: the discounted, asynchronous summarization path (OpenAI
 * Batch API today — 50% off, ~24h SLA). Deliberately split into submit +
 * checkStatus rather than one blocking call, matching how the underlying
 * batch job actually works (fire-and-poll, not request/response).
 *
 * One submit() call produces all four summary dimensions in a single batch
 * (4 JSONL lines → 4 completions) so the cost is one batch overhead, not four.
 */
export interface BatchSummarizationPort {
  submit(fullText: string, trackId: string): Promise<string>; // -> batch job id
  checkStatus(batchJobId: string, trackId: string): Promise<BatchSummaryCheckResult>;
}

export const BATCH_SUMMARIZATION_PORT = Symbol('BATCH_SUMMARIZATION_PORT');
