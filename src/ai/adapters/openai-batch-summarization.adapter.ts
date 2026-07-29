import { Injectable, Logger } from '@nestjs/common';
import { toFile } from 'openai/uploads';
import { OpenAiService } from '../../common/services/openai.service';
import { BatchSummaryCheckResult, BatchSummarizationPort } from '../ports/batch-summarization.port';
import { TrackSummaries, SummarySection, SUMMARY_SECTIONS } from '../../audio-track/audio-track.entity';

const MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 800;

const LANG_INSTRUCTION =
  'Detect the language of the transcript and write your entire response in that exact language.';

const PROMPTS: Record<SummarySection, string> = {
  [SummarySection.Executive]:
    `${LANG_INSTRUCTION} ` +
    'Write a brief executive summary of the meeting: 3-5 sentences about the main outcome. ' +
    'No bullet points, only coherent text.',
  [SummarySection.ActionItems]:
    `${LANG_INSTRUCTION} ` +
    'Extract all action items from the meeting. For each item include: ' +
    'who is responsible (if mentioned), what needs to be done, deadline (if mentioned). ' +
    'Format: bullet list.',
  [SummarySection.KeyDecisions]:
    `${LANG_INSTRUCTION} ` +
    'Extract only the key decisions made during the meeting. ' +
    'No discussion details — only final agreements. Format: bullet list.',
  [SummarySection.Detailed]:
    `${LANG_INSTRUCTION} ` +
    'Write a detailed structured summary of the meeting in chronological order. ' +
    'Preserve all important details, numbers, names.',
};

@Injectable()
export class OpenAiBatchSummarizationAdapter implements BatchSummarizationPort {
  private readonly logger = new Logger(OpenAiBatchSummarizationAdapter.name);

  constructor(private readonly openai: OpenAiService) {}

  async submit(fullText: string, trackId: string): Promise<string> {
    this.logger.log(`→ submitting batch for track=${trackId} text=${fullText.length} chars, prompts: ${SUMMARY_SECTIONS.join(', ')}`);
    const lines = SUMMARY_SECTIONS.map((key) =>
      JSON.stringify({
        custom_id: `${trackId}__${key}`,
        method: 'POST',
        url: '/v1/chat/completions',
        body: {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          messages: [
            { role: 'system', content: PROMPTS[key] },
            { role: 'user', content: fullText },
          ],
        },
      }),
    ).join('\n');

    const uploadedFile = await this.openai.client.files.create({
      file: await toFile(Buffer.from(lines, 'utf-8'), `${trackId}.jsonl`),
      purpose: 'batch',
    });

    const batch = await this.openai.client.batches.create({
      input_file_id: uploadedFile.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
    });

    this.logger.log(`← batch created: id=${batch.id} status=${batch.status}`);
    return batch.id;
  }

  async checkStatus(batchJobId: string, trackId: string): Promise<BatchSummaryCheckResult> {
    const batch = await this.openai.client.batches.retrieve(batchJobId);

    if (batch.status === 'completed' && batch.output_file_id) {
      const fileContent = await this.openai.client.files.content(batch.output_file_id);
      const text = await fileContent.text();

      const summaries = {} as TrackSummaries;
      for (const line of text.trim().split('\n').filter(Boolean)) {
        const parsed = JSON.parse(line);
        const customId: string = parsed?.custom_id ?? '';
        const key = customId.replace(`${trackId}__`, '') as SummarySection;
        if (SUMMARY_SECTIONS.includes(key)) {
          summaries[key] = parsed?.response?.body?.choices?.[0]?.message?.content ?? '';
        }
      }

      return { status: 'completed', summaries };
    }

    if (batch.status === 'failed' || batch.status === 'expired' || batch.status === 'cancelled') {
      return { status: 'failed' };
    }

    return { status: 'in_progress' };
  }
}
