import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { AudioTrackEntity, AudioTrackStatus } from '../audio-track/audio-track.entity';
import type { ActionTask } from '../audio-track/audio-track.entity';
import { CHAT_COMPLETION_PORT, ChatCompletionPort } from '../ai/ports/chat-completion.port';
import { SUMMARIZATION_PORT, SummarizationPort, SummaryTemplate } from '../ai/ports/summarization.port';
import { EncryptionService } from '../common/services/encryption.service';

const TASKS_PROMPT =
  'Extract all action items / tasks from the transcript. ' +
  'Return JSON object: { "tasks": [ { "text": "<task description in the transcript language>" } ] }. ' +
  'If no tasks found, return { "tasks": [] }. ' +
  'Use ONLY information from the transcript — do NOT invent anything.';

@Injectable()
export class BackfillTasksCron {
  private readonly logger = new Logger(BackfillTasksCron.name);
  private running = false;

  constructor(
    @InjectRepository(AudioTrackEntity)
    private readonly trackRepo: Repository<AudioTrackEntity>,
    @Inject(CHAT_COMPLETION_PORT) private readonly chat: ChatCompletionPort,
    @Inject(SUMMARIZATION_PORT) private readonly summarization: SummarizationPort,
    private readonly encryption: EncryptionService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (this.running) return;

    const [tasksRaw, tagsNeeded] = await Promise.all([
      // summaries is now TEXT (encrypted JSON) — can't use JSONB operators.
      // Fetch candidates and filter after decryption.
      this.trackRepo
        .createQueryBuilder('t')
        .where('t.status = :status', { status: AudioTrackStatus.COMPLETED })
        .andWhere('t.summaries IS NOT NULL')
        .andWhere('t."fullText" IS NOT NULL')
        .limit(50)
        .getMany(),
      this.trackRepo
        .createQueryBuilder('t')
        .where('t.status = :status', { status: AudioTrackStatus.COMPLETED })
        .andWhere('t."fullText" IS NOT NULL')
        .andWhere('t."tagsProcessed" = FALSE')
        .limit(10)
        .getMany(),
    ]);

    // Decrypt and keep only tracks that are missing tasks
    const tasksNeeded = tasksRaw
      .map((t) => this.encryption.decryptTrack(t))
      .filter((t) => !t.summaries?.tasks);

    if (tasksNeeded.length === 0 && tagsNeeded.length === 0) return;

    this.running = true;
    this.logger.log(`Backfilling: ${tasksNeeded.length} track(s) need tasks, ${tagsNeeded.length} need tags`);

    try {
      for (const track of tasksNeeded) {
        try {
          // track.fullText is already decrypted (decryptTrack called above)
          const tasks = await this.extractTasks(track.fullText!);
          const encryptedSummaries = this.encryption.encryptJson({ ...track.summaries!, tasks });
          await this.trackRepo.update(track.id, {
            summaries: encryptedSummaries as any,
          });
          this.logger.log(`✓ tasks: track ${track.id} — ${tasks.length} task(s)`);
        } catch (err) {
          this.logger.error(`✗ tasks: track ${track.id} — ${(err as Error).message}`);
        }
      }

      for (const track of tagsNeeded) {
        try {
          this.encryption.decryptTrack(track);
          const { tags, eventDate } = await this.summarization.summarize(track.fullText!, SummaryTemplate.Custom, track.createdAt);
          await this.trackRepo
            .createQueryBuilder()
            .update()
            .set({ tags, eventDate, tagsProcessed: true } as any)
            .where('id = :id', { id: track.id })
            .execute();
          this.logger.log(`✓ tags: track ${track.id} — ${tags.join(', ')} | eventDate: ${eventDate?.toISOString() ?? 'null'}`);
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
      const parsed = JSON.parse(raw || '{}');
      const arr = Array.isArray(parsed) ? parsed : (parsed?.tasks ?? []);
      return arr
        .filter((item: unknown): item is { text: string } => typeof (item as { text?: unknown })?.text === 'string' && (item as { text: string }).text.trim().length > 0)
        .map((item: { text: string }) => ({ id: randomUUID(), text: item.text.trim(), done: false }));
    } catch {
      this.logger.warn(`Failed to parse tasks JSON: ${raw?.slice(0, 200)}`);
      return [];
    }
  }
}
