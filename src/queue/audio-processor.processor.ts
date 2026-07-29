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
import { SUMMARIZATION_PORT, SummarizationPort, SummaryTemplate } from '../ai/ports/summarization.port';
import { BALANCE_CHECKER_PORT, BalanceCheckerPort } from '../billing/ports/balance-checker.port';
import { TelegramApiClient } from '../audio-ingest/adapters/inbound/telegram/telegram-api.client';
import type { AudioProcessingJob } from './audio-processing-job.interface';
import { UserEntity } from '../user/user.entity';
import { EncryptionService } from '../common/services/encryption.service';

@Processor('audio-processing')
export class AudioProcessorProcessor {
  private readonly logger = new Logger(AudioProcessorProcessor.name);

  constructor(
    @InjectRepository(AudioTrackEntity)
    private readonly trackRepo: Repository<AudioTrackEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly chunkRepo: AudioChunkRepository,
    private readonly notifications: NotificationService,
    @InjectQueue('audio-processing') private readonly queue: Queue,
    @Inject(AUDIO_RETRIEVAL_PORT) private readonly retrieval: AudioRetrievalPort,
    @Inject(TRANSCRIPTION_PORT) private readonly transcription: TranscriptionPort,
    @Inject(EMBEDDING_PORT) private readonly embedding: EmbeddingPort,
    @Inject(SUMMARIZATION_PORT) private readonly summarization: SummarizationPort,
    @Inject(BALANCE_CHECKER_PORT) private readonly balance: BalanceCheckerPort,
    private readonly telegram: TelegramApiClient,
    private readonly encryption: EncryptionService,
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
      const VALID_TEMPLATES = new Set<string>(Object.values(SummaryTemplate));
      const detected = job.data.detectedTemplate;
      const template: SummaryTemplate = detected && VALID_TEMPLATES.has(detected)
        ? (detected as SummaryTemplate)
        : SummaryTemplate.Meeting;
      this.logger.log(`[${trackId}] C+D: embedding + summarize (template=${template}) in parallel`);
      const t2 = Date.now();
      const track = await this.trackRepo.findOneByOrFail({ id: trackId });
      const [result] = await Promise.all([
        this.summarization.summarize(fullText, template, track.createdAt),
        this.embedAndStoreChunks(trackId, userId, fullText),
      ]);
      const { summaries, tags, eventDate } = result;
      this.logger.log(`[${trackId}] C+D: done in ${Date.now() - t2}ms — tags: ${tags.join(', ')} | eventDate: ${eventDate?.toISOString() ?? 'null'}`);

      // --- Step F: save results + full-text search vector ---
      const encryptedFullText = this.encryption.encrypt(fullText);
      const encryptedSummaries = this.encryption.encryptJson(summaries);
      await this.trackRepo.manager.query(
        `UPDATE audio_tracks
         SET summaries = $1, tags = $2, "fullText" = $3,
             "searchVector" = to_tsvector('simple', $4),
             "eventDate" = $5,
             "tagsProcessed" = TRUE,
             status = $6
         WHERE id = $7`,
        [encryptedSummaries, tags, encryptedFullText, fullText, eventDate, AudioTrackStatus.COMPLETED, trackId],
      );
      this.logger.log(`[${trackId}] F: saved summaries + tags + full-text index, status=COMPLETED`);

      await this.userRepo.increment({ id: track.userId }, 'freeTracksUsed', 1);

      const consumedMinutes = Math.ceil(track.duration / 60);
      await this.balance.consumeMinutes(track.userId, consumedMinutes);
      this.logger.log(`[${trackId}] F: consumed ${consumedMinutes} min for user ${track.userId}`);

      if (track.telegramChatId) {
        this.logger.log(`[${trackId}] F: sending results to telegram chat ${track.telegramChatId}`);
        const summaryText = formatSummaries(summaries, tags, track);
        const calendarButtons = buildCalendarKeyboard(tags, trackId);
        try {
          if (calendarButtons.length > 0) {
            await this.telegram.sendMessageWithKeyboard(track.telegramChatId, summaryText, calendarButtons, 'HTML');
          } else {
            await this.telegram.sendMessage(track.telegramChatId, summaryText, 'HTML', track.telegramMessageId ?? undefined);
          }
        } catch (sendErr) {
          this.logger.error(`[${trackId}] HTML send failed (${(sendErr as Error).message}), retrying as plain text`);
          await this.telegram.sendMessage(track.telegramChatId, formatSummariesPlain(summaries, tags, track));
        }
        try {
          await this.telegram.sendMessage(
            track.telegramChatId,
            `📄 Transcript\n\n${fullText}`,
          );
        } catch (sendErr) {
          this.logger.error(`[${trackId}] transcript send failed: ${(sendErr as Error).message}`);
        }
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

function htmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


function formatSummariesPlain(s: TrackSummaries, tags: string[], track: AudioTrackEntity): string {
  const date = track.createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = track.createdAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const tagsLine = tags.length > 0 ? `\n\n🏷 ${tags.map((t) => `#${t}`).join(' ')}` : '';
  return [
    `🎙 Recording ${date} at ${time}`,
    `📋 Executive Summary\n${s.executive}`,
    `✅ Action Items\n${s.actionItems}`,
    `🔑 Key Decisions\n${s.keyDecisions}`,
    `📝 Detailed Summary\n${s.detailed}${tagsLine}`,
  ].join('\n\n─────────────────\n\n');
}

function formatSummaries(s: TrackSummaries, tags: string[], track: AudioTrackEntity): string {
  const sep = '─────────────────';

  const date = track.createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = track.createdAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const durationMin = Math.floor(track.duration / 60);
  const durationSec = track.duration % 60;
  const durationStr = durationMin > 0 ? `${durationMin}m ${durationSec}s` : `${durationSec}s`;

  const e = htmlEscape;
  const tagsLine = tags.length > 0 ? `\n\n🏷 ${tags.map((t) => `#${e(t)}`).join(' ')}` : '';
  const parts = [
    `🎙 <b>Recording ${e(date)} at ${e(time)}</b> (${e(durationStr)})`,
    `📋 <b>Executive Summary</b>\n${e(s.executive)}`,
    `✅ <b>Action Items</b>\n${e(s.actionItems)}`,
    `🔑 <b>Key Decisions</b>\n${e(s.keyDecisions)}`,
    `📝 <b>Detailed Summary</b>\n${e(s.detailed)}${tagsLine}`,
  ];
  return parts.join(`\n\n${sep}\n\n`);
}

// Tags that imply a scheduled call/meeting — clicking them shows archive records of that type.
// AI is instructed to always use English for calendar-type tags.
const CALENDAR_TAG_PATTERNS = [
  /^call$/i, /meeting/i, /interview/i, /sync/i, /zoom/i, /webinar/i, /conference/i, /lesson/i,
];

function isCalendarTag(tag: string): boolean {
  return CALENDAR_TAG_PATTERNS.some((re) => re.test(tag));
}

// Returns inline keyboard rows for calendar-type tags only.
// Each button: click → show archive records of that type from CalendarCallbackService.
// cal_events:<trackId(36)> = 47 bytes — within Telegram's 64-byte limit ✓
function buildCalendarKeyboard(
  tags: string[],
  trackId: string,
): Array<Array<{ text: string; callback_data: string }>> {
  return tags
    .filter(isCalendarTag)
    .map((tag) => [{ text: `📅 #${tag}`, callback_data: `cal_events:${trackId}` }]);
}
