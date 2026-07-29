import { InjectQueue, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Job, Queue } from 'bull';
import { AudioTrackEntity, AudioTrackStatus, TrackSummaries } from '../audio-track/audio-track.entity';
import { AudioChunkRepository } from '../audio-chunk/audio-chunk.repository';
import { NotificationService } from '../notification/notification.service';
import { chunkTextBySentence, dayOfWeekOf } from '../common/services/text-chunker.util';
import { AUDIO_RETRIEVAL_PORT, AudioRetrievalPort } from './ports/audio-retrieval.port';
import { TRANSCRIPTION_PORT, TranscriptionPort } from '../ai/ports/transcription.port';
import { EMBEDDING_PORT, EmbeddingPort } from '../ai/ports/embedding.port';
import { SUMMARIZATION_PORT, SummarizationPort } from '../ai/ports/summarization.port';
import { BALANCE_CHECKER_PORT, BalanceCheckerPort } from '../billing/ports/balance-checker.port';
import { TelegramApiClient } from '../audio-ingest/adapters/inbound/telegram/telegram-api.client';
import type { SummaryTemplate } from '../ai/ports/summarization.port';
import type { AudioProcessingJob } from './audio-processing-job.interface';
import { TAGGING_PORT, TaggingPort } from '../ai/ports/tagging.port';

@Processor('audio-processing')
export class AudioProcessorProcessor {
  private readonly logger = new Logger(AudioProcessorProcessor.name);

  constructor(
    @InjectRepository(AudioTrackEntity)
    private readonly trackRepo: Repository<AudioTrackEntity>,
    private readonly chunkRepo: AudioChunkRepository,
    private readonly notifications: NotificationService,
    @InjectQueue('audio-processing') private readonly queue: Queue,
    @Inject(AUDIO_RETRIEVAL_PORT) private readonly retrieval: AudioRetrievalPort,
    @Inject(TRANSCRIPTION_PORT) private readonly transcription: TranscriptionPort,
    @Inject(EMBEDDING_PORT) private readonly embedding: EmbeddingPort,
    @Inject(SUMMARIZATION_PORT) private readonly summarization: SummarizationPort,
    @Inject(BALANCE_CHECKER_PORT) private readonly balance: BalanceCheckerPort,
    private readonly telegram: TelegramApiClient,
    @Inject(TAGGING_PORT) private readonly tagging: TaggingPort,
  ) {}

  @Process({ name: 'process-audio-track', concurrency: 20 })
  async handleProcessAudioTrack(job: Job<AudioProcessingJob>): Promise<void> {
    const { trackId, storageKey, userId } = job.data;

    try {
      if (job.attemptsMade === 0) {
        await this.trackRepo.update(trackId, { status: AudioTrackStatus.PROCESSING });
      }

      // --- Step A: download audio ---
      this.logger.log(`[${trackId}] A: downloading audio (key=${storageKey})`);
      const t0 = Date.now();
      const audioBuffer = await this.retrieval.getBuffer(storageKey);
      this.logger.log(`[${trackId}] A: downloaded ${audioBuffer.length} bytes in ${Date.now() - t0}ms`);

      // --- Step B: STT (skipped if already transcribed by inbound adapter) ---
      let fullText: string;
      if (job.data.preTranscribedText) {
        fullText = job.data.preTranscribedText;
        this.logger.log(`[${trackId}] B: using pre-transcribed text (${fullText.length} chars) — skipping STT`);
      } else {
        const fileName = storageKey.split('/').pop() ?? 'audio.ogg';
        this.logger.log(`[${trackId}] B: transcribing (file=${fileName})`);
        const t1 = Date.now();
        fullText = await this.transcription.transcribe(audioBuffer, fileName);
        this.logger.log(`[${trackId}] B: transcription done in ${Date.now() - t1}ms — ${fullText.length} chars`);
        this.logger.debug(`[${trackId}] B: preview: ${fullText.slice(0, 200)}`);
      }

      // --- Step C: chunk + embed for RAG (parallel with summarization) ---
      // --- Step D: summarize with auto-detected template ---
      const VALID_TEMPLATES = new Set<SummaryTemplate>(['meeting', 'interview', 'lecture', 'sales_call', 'custom']);
      const detected = job.data.detectedTemplate as SummaryTemplate | undefined;
      const template: SummaryTemplate = detected && VALID_TEMPLATES.has(detected) ? detected : 'meeting';
      this.logger.log(`[${trackId}] C+D+E: embedding, summarizing, tagging in parallel (template=${template})`);
      const t2 = Date.now();
      const [summaries, tags] = await Promise.all([
        this.summarization.summarize(fullText, template),
        this.tagging.extractTags(fullText),
        this.embedAndStoreChunks(trackId, userId, fullText),
      ]);
      this.logger.log(`[${trackId}] C+D+E: done in ${Date.now() - t2}ms — tags: ${tags.join(', ')}`);

      // --- Step F: save results + full-text search vector ---
      const track = await this.trackRepo.findOneByOrFail({ id: trackId });
      await this.trackRepo.manager.query(
        `UPDATE audio_tracks
         SET summaries = $1, tags = $2, "fullText" = $3,
             "searchVector" = to_tsvector('simple', $3),
             status = $4
         WHERE id = $5`,
        [JSON.stringify(summaries), tags, fullText, AudioTrackStatus.COMPLETED, trackId],
      );
      this.logger.log(`[${trackId}] F: saved summaries + tags + full-text index, status=COMPLETED`);

      const consumedMinutes = Math.ceil(track.duration / 60);
      await this.balance.consumeMinutes(track.userId, consumedMinutes);
      this.logger.log(`[${trackId}] F: consumed ${consumedMinutes} min for user ${track.userId}`);

      if (track.telegramChatId) {
        this.logger.log(`[${trackId}] F: sending results to telegram chat ${track.telegramChatId}`);
        await this.telegram.sendMessage(
          track.telegramChatId,
          formatSummaries(summaries, tags, track),
          'MarkdownV2',
          track.telegramMessageId ?? undefined,
        );
        await this.telegram.sendMessage(
          track.telegramChatId,
          `📄 *Transcript*\n\n${mdv2Escape(fullText)}`,
          'MarkdownV2',
        );
      } else {
        await this.notifications.sendPushNotification(track.userId, trackId, 'Your meeting summary is ready');
      }
    } catch (error) {
      this.logger.error(`[${trackId}] failed on attempt ${job.attemptsMade + 1}: ${(error as Error).message}`);
      throw error;
    }
  }

  @OnQueueFailed()
  async handleFailed(job: Job, error: Error): Promise<void> {
    if (job.name !== 'process-audio-track') return;
    const { trackId } = job.data as AudioProcessingJob;
    this.logger.error(`Track ${trackId} permanently failed after ${job.attemptsMade} attempts: ${error.message}`);
    await this.trackRepo.update(trackId, { status: AudioTrackStatus.FAILED });
  }

  private async embedAndStoreChunks(trackId: string, userId: string, fullText: string): Promise<void> {
    const textChunks = chunkTextBySentence(fullText, 800);
    if (textChunks.length === 0) return;

    const vectors = await this.embedding.embed(textChunks);

    const now = new Date();
    const inserts = textChunks.map((text, index) => ({
      trackId,
      userId,
      text,
      embedding: vectors[index],
      dayOfWeek: dayOfWeekOf(now),
      createdAt: now,
    }));

    await this.chunkRepo.insertMany(inserts);
  }
}

// Escape special MarkdownV2 characters outside of spoiler/bold blocks
function mdv2Escape(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function formatSummaries(s: TrackSummaries, tags: string[], track: AudioTrackEntity): string {
  const sep = mdv2Escape('─────────────────');

  const date = track.createdAt.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = track.createdAt.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  const durationMin = Math.floor(track.duration / 60);
  const durationSec = track.duration % 60;
  const durationStr = durationMin > 0
    ? `${durationMin} хв ${durationSec} с`
    : `${durationSec} с`;

  const parts = [
    `🎙 *Запис від ${mdv2Escape(date)} о ${mdv2Escape(time)}* \\(${mdv2Escape(durationStr)}\\)`,
    `📋 *Executive Summary*\n${mdv2Escape(s.executive)}`,
    `✅ *Action Items*\n${mdv2Escape(s.actionItems)}`,
    `🔑 *Key Decisions*\n${mdv2Escape(s.keyDecisions)}`,
    `📝 *Detailed Summary*\n${mdv2Escape(s.detailed)}`,
  ];
  if (tags.length > 0) {
    const hashtags = tags.map((t) => mdv2Escape(`#${t.replace(/\s+/g, '_')}`)).join(' ');
    parts.push(`🏷 *Tags*\n${hashtags}`);
  }
  return parts.join(`\n\n${sep}\n\n`);
}
