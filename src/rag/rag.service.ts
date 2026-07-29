import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { CHAT_COMPLETION_PORT, ChatCompletionPort } from '../ai/ports/chat-completion.port';
import { EMBEDDING_PORT, EmbeddingPort } from '../ai/ports/embedding.port';
import { AudioChunkRepository, SimilaritySearchResult } from '../audio-chunk/audio-chunk.repository';

interface DateWindow {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  cleanQuery: string;
}

export interface AskResult {
  answer: string;
  window: { startDate: string; endDate: string };
  sourceChunks: Array<{ trackId: string; createdAt: Date; distance: number }>;
}

const ANSWER_SYSTEM_PROMPT =
  'You are an assistant that answers questions based on the user\'s meeting transcripts. ' +
  'Answer ONLY from the provided context. If there is not enough context, honestly say that the information was not found. ' +
  'Always mention the date and time of the meetings the information was taken from. ' +
  'Reply in the same language the user used in their question.';

/**
 * Hybrid RAG: a calendar/date filter (cheap, exact) narrows the search space before
 * the expensive vector similarity search runs, which keeps the pgvector query fast
 * and relevant even as a user's history grows to thousands of chunks.
 *
 * Depends only on CHAT_COMPLETION_PORT/EMBEDDING_PORT — no OpenAI SDK import here.
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    @Inject(CHAT_COMPLETION_PORT) private readonly chat: ChatCompletionPort,
    @Inject(EMBEDDING_PORT) private readonly embedding: EmbeddingPort,
    private readonly chunkRepo: AudioChunkRepository,
  ) {}

  async ask(userId: string, query: string): Promise<AskResult> {
    const window = await this.extractDateWindow(query);
    const [queryEmbedding] = await this.embedding.embed([window.cleanQuery]);

    const topChunks = await this.chunkRepo.searchTopK({
      userId,
      startDate: window.startDate,
      endDate: window.endDate,
      queryEmbedding,
      topK: 5,
    });

    const answer = await this.generateAnswer(window.cleanQuery, topChunks);

    return {
      answer,
      window: { startDate: window.startDate, endDate: window.endDate },
      sourceChunks: topChunks.map((c) => ({
        trackId: c.trackId,
        createdAt: c.createdAt,
        distance: c.distance,
      })),
    };
  }

  private async extractDateWindow(query: string): Promise<DateWindow> {
    const today = new Date().toISOString().slice(0, 10);
    // Fallback window when the user doesn't mention a date at all — search the
    // last 365 days rather than just today, so "what did we discuss about X?"
    // finds answers across the full history instead of returning nothing.
    const farPast = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const systemPrompt =
      `Today is ${today}. Extract the date range and the core question from the user's query.\n` +
      `Rules:\n` +
      `- "today" → startDate = endDate = ${today}\n` +
      `- "yesterday" → startDate = endDate = yesterday\n` +
      `- "this week" → startDate = Monday of current week, endDate = ${today}\n` +
      `- "last week" → startDate = Monday of previous week, endDate = Sunday of previous week\n` +
      `- "this month" → startDate = first day of current month, endDate = ${today}\n` +
      `- "last month" → full previous calendar month\n` +
      `- "last N days/weeks/months" → calculate accordingly from ${today}\n` +
      `- specific month/year mentioned → that full calendar month\n` +
      `- no date mentioned at all → startDate = ${farPast}, endDate = ${today}\n` +
      `Return ONLY valid JSON (no markdown): { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "cleanQuery": "<question without date references, in original language>" }`;

    const raw = await this.chat.complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      { temperature: 0, responseFormatJson: true },
    );

    try {
      const parsed = JSON.parse(raw || '{}');
      if (!parsed.startDate || !parsed.endDate || !parsed.cleanQuery) {
        throw new Error('Missing fields in NLU response');
      }
      return parsed as DateWindow;
    } catch (error) {
      this.logger.error('Failed to parse date-window NLU response', error as Error);
      throw new InternalServerErrorException('Could not interpret the time range of the question');
    }
  }

  private async generateAnswer(
    cleanQuery: string,
    chunks: SimilaritySearchResult[],
  ): Promise<string> {
    const context = chunks
      .map((c, i) => {
        const d = new Date(c.createdAt);
        const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
          + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        return `[Fragment ${i + 1} | meeting ${date}]\n${c.text}`;
      })
      .join('\n\n');

    return this.chat.complete(
      [
        { role: 'system', content: ANSWER_SYSTEM_PROMPT },
        { role: 'user', content: `Meeting context:\n${context}\n\nQuestion: ${cleanQuery}` },
      ],
      { temperature: 0.2 },
    );
  }
}
