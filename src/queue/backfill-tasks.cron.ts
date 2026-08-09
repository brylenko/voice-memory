import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { AudioTrackEntity, AudioTrackStatus, TrackSummaries } from '../audio-track/audio-track.entity';
import type { ActionTask } from '../audio-track/audio-track.entity';
import { CHAT_COMPLETION_PORT, ChatCompletionPort } from '../ai/ports/chat-completion.port';
import { SUMMARIZATION_PORT, SummarizationPort, SummaryTemplate } from '../ai/ports/summarization.port';
import { EncryptionService } from '../common/services/encryption.service';
import {
  AUDIO_PROCESSING_QUEUE_PORT,
  AudioProcessingQueuePort,
} from '../audio-ingest/application/ports/outbound/audio-processing-queue.port';
import {
  AUDIO_STORAGE_PORT,
  AudioStoragePort,
} from '../audio-ingest/application/ports/outbound/audio-storage.port';

// C3: re-enqueue tracks whose Redis job was lost (DB ok, queue empty).
const STALE_INITIALIZED_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

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
    @Inject(AUDIO_PROCESSING_QUEUE_PORT) private readonly processingQueue: AudioProcessingQueuePort,
    @Inject(AUDIO_STORAGE_PORT) private readonly storage: AudioStoragePort,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    // C3: tracks > 5 min INITIALIZED → queue job was probably lost → re-enqueue.
    await this.reconcileStaleInitialized();
    // C2: tracks > 30 min INITIALIZED → client probably abandoned the upload → check S3.
    await this.reconcileAbandonedUploads();

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
          await this.trackRepo
            .createQueryBuilder()
            .update()
            .set({ summaries: encryptedSummaries as unknown as TrackSummaries })
            .where('id = :id', { id: track.id })
            .execute();
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
            .set({ tags, eventDate, tagsProcessed: true })
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

  /**
   * C2 fix: find INITIALIZED tracks older than the abandonment threshold and
   * verify that the corresponding storage object actually exists.
   *
   * Three outcomes:
   *   exists      → leave INITIALIZED; the C3 re-enqueue reconciler will handle it.
   *   missing     → conditional UPDATE to FAILED (WHERE status = INITIALIZED so a
   *                 racing worker that already moved to PROCESSING is never touched).
   *   S3 error    → log and skip; try again next cron tick. Do not mark FAILED on
   *                 transient infrastructure failures.
   */
  private async reconcileAbandonedUploads(): Promise<void> {
    const thresholdMinutes = this.config.get<number>('staleUploadThresholdMinutes') ?? 30;
    const abandonThreshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    const candidates = await this.trackRepo
      .createQueryBuilder('t')
      .where('t.status = :status', { status: AudioTrackStatus.INITIALIZED })
      .andWhere('t."createdAt" < :threshold', { threshold: abandonThreshold })
      .limit(20)
      .getMany();

    if (candidates.length === 0) return;
    this.logger.log(`C2 reconciler: ${candidates.length} candidate(s) older than ${thresholdMinutes} min`);

    for (const track of candidates) {
      try {
        const objectExists = await this.storage.exists(track.fileUrl);
        if (objectExists) {
          this.logger.log(`C2 reconciler: track ${track.id} — object exists, leaving INITIALIZED`);
          continue;
        }

        // Object is definitely absent — mark FAILED using conditional UPDATE so
        // a concurrent status change (INITIALIZED → PROCESSING) is never overwritten.
        const result = await this.trackRepo.manager.query(
          `UPDATE audio_tracks SET status = $1 WHERE id = $2 AND status = $3`,
          [AudioTrackStatus.FAILED, track.id, AudioTrackStatus.INITIALIZED],
        );
        const affected = Array.isArray(result) ? (result[1] as number) : 0;
        if (affected > 0) {
          this.logger.warn(`C2 reconciler: track ${track.id} marked FAILED — S3 object missing`);
        } else {
          this.logger.log(`C2 reconciler: track ${track.id} — status changed concurrently, skipping`);
        }
      } catch (err) {
        // Transient storage error (timeout, 5xx, auth) — do not change business state.
        this.logger.warn(`C2 reconciler: track ${track.id} — storage check failed, will retry: ${(err as Error).message}`);
      }
    }
  }

  private async reconcileStaleInitialized(): Promise<void> {
    const staleThreshold = new Date(Date.now() - STALE_INITIALIZED_THRESHOLD_MS);
    const stale = await this.trackRepo
      .createQueryBuilder('t')
      .where('t.status = :status', { status: AudioTrackStatus.INITIALIZED })
      .andWhere('t."createdAt" < :threshold', { threshold: staleThreshold })
      .limit(20)
      .getMany();

    if (stale.length === 0) return;
    this.logger.warn(`Reconciler: ${stale.length} stale INITIALIZED track(s) — re-enqueueing`);

    for (const track of stale) {
      try {
        // Uses the same AudioProcessingQueuePort as upload-complete — jobId=trackId
        // is set inside BullMqAudioQueueAdapter, so concurrent reconciliation + upload-complete
        // calls for the same track produce at most one pending job.
        await this.processingQueue.enqueue({
          trackId: track.id,
          storageKey: track.fileUrl,
          userId: track.userId,
        });
        this.logger.log(`Reconciler: re-enqueued track ${track.id}`);
      } catch (err) {
        this.logger.error(`Reconciler: failed to re-enqueue track ${track.id}: ${(err as Error).message}`);
      }
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
