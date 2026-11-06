import { Injectable } from '@nestjs/common';
import { RagService } from '../../../rag/rag.service';
import { DayDigestService } from '../../../memory/day-digest.service';
import type { MemoryRecall, MemoryRecallPort } from '../../application/ports/memory-recall.port';

const MAX_DISTANCE = 0.75; // explicit memory questions: be more permissive than opportunistic hints

/** MemoryRecallPort backed by the existing date-aware RAG search and the day digest. */
@Injectable()
export class RagMemoryRecallAdapter implements MemoryRecallPort {
  constructor(
    private readonly rag: RagService,
    private readonly days: DayDigestService,
  ) {}

  async recall(
    userId: string,
    request: string,
    opts: { includeDay: boolean; tzOffsetMinutes: number },
  ): Promise<MemoryRecall> {
    const [{ window, chunks }, day] = await Promise.all([
      this.rag.recall(userId, request, 6),
      opts.includeDay ? this.days.getDay(userId, { tzOffsetMinutes: opts.tzOffsetMinutes }) : Promise.resolve(null),
    ]);

    const facts = chunks
      .filter((c) => Number(c.distance) <= MAX_DISTANCE)
      .map((c) => ({ text: c.text, heardAt: new Date(c.createdAt) }));

    // Day items complement vector hits for "what did I hear today" (summaries, newest last).
    if (day) {
      for (const item of day.items.slice(-8)) {
        facts.push({ text: item.summary, heardAt: new Date(item.at) });
      }
    }

    return {
      facts,
      window: { startDate: window.startDate, endDate: window.endDate },
      daySummary: day?.digest ?? null,
    };
  }
}
