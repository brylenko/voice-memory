import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { AudioTrackEntity, AudioTrackStatus } from '../audio-track/audio-track.entity';
import type { ActionTask } from '../audio-track/audio-track.entity';
import { CHAT_COMPLETION_PORT, ChatCompletionPort } from '../ai/ports/chat-completion.port';
import { TAGGING_PORT, TaggingPort } from '../ai/ports/tagging.port';

const TASKS_PROMPT =
  'Extract all action items / tasks from the transcript as a JSON array. ' +
  'Each element: { "text": "<task description in the transcript language>" }. ' +
  'Return ONLY the JSON array, no other text. If no tasks found, return []. ' +
  'Use ONLY information from the transcript — do NOT invent anything.';

@Injectable()
export class BackfillTasksCron {
  private readonly logger = new Logger(BackfillTasksCron.name);
  private running = false;

  constructor(
    @InjectRepository(AudioTrackEntity)
    private readonly trackRepo: Repository<AudioTrackEntity>,
    @Inject(CHAT_COMPLETION_PORT) private readonly chat: ChatCompletionPort,
    @Inject(TAGGING_PORT) private readonly tagging: TaggingPort,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (this.running) return;

    const [tasksNeeded, tagsNeeded] = await Promise.all([
      this.trackRepo
        .createQueryBuilder('t')
        .where('t.status = :status', { status: AudioTrackStatus.COMPLETED })
        .andWhere('t.summaries IS NOT NULL')
        .andWhere("t.summaries->'tasks' IS NULL")
        .andWhere('t."fullText" IS NOT NULL')
        .limit(10)
        .getMany(),
      this.trackRepo
        .createQueryBuilder('t')
        .where('t.status = :status', { status: AudioTrackStatus.COMPLETED })
        .andWhere('t."fullText" IS NOT NULL')
        .andWhere("t.tags = '{}'")
        .limit(10)
        .getMany(),
    ]);

    if (tasksNeeded.length === 0 && tagsNeeded.length === 0) return;

    this.running = true;
    this.logger.log(`Backfilling: ${tasksNeeded.length} track(s) need tasks, ${tagsNeeded.length} need tags`);

    try {
      for (const track of tasksNeeded) {
        try {
          const tasks = await this.extractTasks(track.fullText!);
          await this.trackRepo.update(track.id, {
            summaries: { ...track.summaries!, tasks },
          });
          this.logger.log(`✓ tasks: track ${track.id} — ${tasks.length} task(s)`);
        } catch (err) {
          this.logger.error(`✗ tasks: track ${track.id} — ${(err as Error).message}`);
        }
      }

      for (const track of tagsNeeded) {
        try {
          const tags = await this.tagging.extractTags(track.fullText!);
          await this.trackRepo
            .createQueryBuilder()
            .update()
            .set({ tags } as any)
            .where('id = :id', { id: track.id })
            .execute();
          this.logger.log(`✓ tags: track ${track.id} — ${tags.join(', ')}`);
        } catch (err) {
          this.logger.error(`✗ tags: track ${track.id} — ${(err as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async extractTasks(fullText: string): Promise<ActionTask[]> {
    const raw = await this.chat.complete(
      [
        { role: 'system', content: TASKS_PROMPT },
        { role: 'user', content: fullText },
      ],
      { temperature: 0, responseFormatJson: true },
    );

    try {
      const parsed = JSON.parse(raw || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is { text: string } => typeof item?.text === 'string' && item.text.trim().length > 0)
        .map((item) => ({ id: randomUUID(), text: item.text.trim(), done: false }));
    } catch {
      this.logger.warn(`Failed to parse tasks JSON: ${raw?.slice(0, 200)}`);
      return [];
    }
  }
}
