import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EMBEDDING_PORT, EmbeddingPort } from '../ai/ports/embedding.port';
import { SUMMARIZATION_PORT, SummarizationPort, SummaryTemplate } from '../ai/ports/summarization.port';
import { AudioTrackEntity, AudioTrackStatus } from '../audio-track/audio-track.entity';
import { AudioChunkRepository } from '../audio-chunk/audio-chunk.repository';
import { chunkTextBySentence, dayOfWeekOf } from '../common/services/text-chunker.util';
import { EncryptionService } from '../common/services/encryption.service';

/**
 * Persistence lifecycle of a track whose transcript is produced live over a
 * WebSocket (no audio file): create → periodic partial saves → finalize
 * (tags, full-text index, embeddings, quota) or markFailed.
 *
 * Extracted from StreamingGateway so the assistant gateway can store its
 * conversations into the same searchable memory without duplicating logic.
 */
@Injectable()
export class LiveTrackService {
  private readonly logger = new Logger(LiveTrackService.name);

  constructor(
    @Inject(EMBEDDING_PORT) private readonly embedding: EmbeddingPort,
    @Inject(SUMMARIZATION_PORT) private readonly summarization: SummarizationPort,
    @InjectRepository(AudioTrackEntity) private readonly trackRepo: Repository<AudioTrackEntity>,
    private readonly chunkRepo: AudioChunkRepository,
    private readonly encryption: EncryptionService,
  ) {}

  async start(userId: string, channel: string): Promise<string> {
    const track = await this.trackRepo.save(
      this.trackRepo.create({
        userId,
        channel,
        duration: 0,
        fileUrl: '',
        status: AudioTrackStatus.PROCESSING,
        fullText: '',
      }),
    );
    return track.id;
  }

  async savePartial(trackId: string, text: string): Promise<void> {
    await this.trackRepo.manager.query(
      `UPDATE audio_tracks SET "fullText" = $1 WHERE id = $2`,
      [this.encryption.encrypt(text), trackId],
    );
  }

  async markFailed(trackId: string, partialText: string): Promise<void> {
    await this.trackRepo.update(trackId, {
      ...(partialText.trim() ? { fullText: this.encryption.encrypt(partialText) } : {}),
      status: AudioTrackStatus.FAILED,
    });
  }

  /** Final save: tags, search vector, embeddings, status=COMPLETED. Idempotent. */
  async finalize(trackId: string, userId: string, fullText: string): Promise<void> {
    if (!fullText.trim()) {
      await this.trackRepo.update(trackId, { status: AudioTrackStatus.COMPLETED });
      return;
    }
    const track = await this.trackRepo.findOneByOrFail({ id: trackId });

    const { tags, eventDate } = await this.summarization.summarize(fullText, SummaryTemplate.Custom, track.createdAt);
    const textChunks = chunkTextBySentence(fullText, 800);

    // Atomic: status transition + quota increment in one transaction.
    // WHERE status != COMPLETED makes this idempotent under retry/concurrent finalize.
    const isFirstCompletion = await this.trackRepo.manager.transaction(async (tx) => {
      const rows: Array<{ userId: string }> = await tx.query(
        `UPDATE audio_tracks
         SET "fullText" = $1, "searchVector" = to_tsvector('simple', $2),
             tags = $3, "eventDate" = $4, "tagsProcessed" = TRUE, status = $5
         WHERE id = $6 AND status != $5
         RETURNING "userId"`,
        [this.encryption.encrypt(fullText), fullText, tags, eventDate, AudioTrackStatus.COMPLETED, trackId],
      );
      if (rows.length === 0) return false;
      await tx.query(
        `UPDATE users SET "freeTracksUsed" = "freeTracksUsed" + 1 WHERE id = $1`,
        [rows[0].userId],
      );
      return true;
    });

    if (!isFirstCompletion) {
      this.logger.warn(`[${trackId}] finalize: track already COMPLETED — skipping chunks and quota`);
      return;
    }

    if (textChunks.length > 0) {
      const vectors = await this.embedding.embed(textChunks);
      const now = new Date();
      await this.chunkRepo.replaceChunks(
        trackId,
        textChunks.map((text, i) => ({
          trackId,
          userId,
          text,
          embedding: vectors[i],
          dayOfWeek: dayOfWeekOf(now),
          createdAt: now,
        })),
      );
    }

    this.logger.log(`[${trackId}] finalized live transcript (${fullText.length} chars, ${textChunks.length} chunks, tags: ${tags.join(', ')})`);
  }
}
