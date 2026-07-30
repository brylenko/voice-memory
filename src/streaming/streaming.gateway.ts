import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server, WebSocket } from 'ws';
import { Readable } from 'stream';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import {
  STREAMING_TRANSCRIPTION_PORT,
  StreamingTranscriptionPort,
} from '../ai/ports/streaming-transcription.port';
import { EMBEDDING_PORT, EmbeddingPort } from '../ai/ports/embedding.port';
import { SUMMARIZATION_PORT, SummarizationPort, SummaryTemplate } from '../ai/ports/summarization.port';
import { AudioTrackEntity, AudioTrackStatus } from '../audio-track/audio-track.entity';
import { AudioChunkRepository } from '../audio-chunk/audio-chunk.repository';
import { UserEntity } from '../user/user.entity';
import { chunkTextBySentence, dayOfWeekOf } from '../common/services/text-chunker.util';
import { EncryptionService } from '../common/services/encryption.service';

interface TranscriptDelta   { type: 'transcript'; text: string; }
interface DoneEvent         { type: 'done'; fullText: string; trackId: string; }
interface ErrorEvent        { type: 'error'; message: string; paymentUrl?: string; }
type ServerEvent = TranscriptDelta | DoneEvent | ErrorEvent;

/**
 * WebSocket gateway for real-time audio streaming + live transcription.
 *
 * Protocol (client → server):
 *   binary frames       — raw PCM16 mono 24 kHz audio chunks (~100 ms each)
 *   text frame "end"    — signals audio stream is complete
 *
 * Protocol (server → client):
 *   {"type":"transcript","text":"..."}              — incremental text delta
 *   {"type":"done","fullText":"...","trackId":"..."}— full transcript + saved track id
 *   {"type":"error","message":"..."}                — something went wrong
 *
 * Query params:
 *   deviceId — device serial / Telegram ID (required); treated as untrusted external ID,
 *              resolved to internal UUID via users table (same as X-Device-Serial on HTTP).
 *              NOT a raw UUID — passing a guessed UUID will simply create a new orphan user.
 *   lang      — BCP-47 language hint, e.g. "uk", "en" (optional)
 */
@WebSocketGateway({ path: '/audio/live' })
export class StreamingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(StreamingGateway.name);
  private readonly sessions = new Map<WebSocket, Readable>();

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(STREAMING_TRANSCRIPTION_PORT)
    private readonly streaming: StreamingTranscriptionPort,
    @Inject(EMBEDDING_PORT)
    private readonly embedding: EmbeddingPort,
    @Inject(SUMMARIZATION_PORT)
    private readonly summarization: SummarizationPort,
    @InjectRepository(AudioTrackEntity)
    private readonly trackRepo: Repository<AudioTrackEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly chunkRepo: AudioChunkRepository,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  private async resolveUser(externalId: string): Promise<{ id: string; quotaExceeded: boolean }> {
    let user = await this.userRepo.findOneBy({ deviceId: externalId });
    if (!user) {
      user = await this.userRepo.save(this.userRepo.create({ deviceId: externalId }));
      this.logger.log(`Created new user for deviceId=${externalId}: ${user.id}`);
    }
    const limit = this.config.get<number>('payment.freeTracksLimit') ?? 10;
    const quotaExceeded = limit > 0 && user.freeTracksUsed >= limit;
    return { id: user.id, quotaExceeded };
  }

  handleConnection(client: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    // Security note: deviceId is an identifier, not a credential — there is no
    // cryptographic proof of ownership here (unlike the REST channel's HMAC guard).
    // Known trade-off: anyone who knows a device serial can stream under its identity.
    // Acceptable while serials are opaque and non-enumerable; add HMAC in query/first-frame
    // if WebSocket needs REST-level auth parity.
    const externalId = url.searchParams.get('deviceId') ?? '';
    const lang       = url.searchParams.get('lang') ?? undefined;

    if (!externalId) {
      client.close(1008, 'deviceId query param is required');
      return;
    }

    this.logger.log(`Client connected (externalId=${externalId})`);

    const audioPassthrough = new Readable({ read() {} });
    this.sessions.set(client, audioPassthrough);
    let audioStarted = false;
    const deltas: string[] = [];

    client.on('message', (data, isBinary) => {
      if (isBinary) {
        if (!audioStarted) {
          audioStarted = true;
          void this.resolveUser(externalId).then(({ id: userId, quotaExceeded }) => {
            if (quotaExceeded && this.config.get<boolean>('payment.required')) {
              this.send(client, {
                type: 'error',
                message: 'Free quota exceeded. Please upgrade to continue.',
                paymentUrl: this.config.get<string>('payment.url'),
              });
              client.close();
              return;
            }
            void this.runSession(client, audioPassthrough, deltas, userId, lang);
          });
        }
        audioPassthrough.push(data as Buffer);
        return;
      }
      const text = (data as Buffer).toString();
      if (text === 'end') {
        audioPassthrough.push(null); // EOF → triggers commit in adapter
      }
    });
  }

  handleDisconnect(client: WebSocket) {
    this.logger.log('Client disconnected from live streaming');
    const stream = this.sessions.get(client);
    if (stream) {
      stream.push(null); // EOF so runSession can finish and persist
      this.sessions.delete(client);
    }
  }

  private async runSession(
    client: WebSocket,
    audioStream: Readable,
    deltas: string[],
    userId: string,
    lang: string | undefined,
  ): Promise<void> {
    if (!userId) return;

    // Create track immediately so partial text is never lost
    const track = await this.trackRepo.save(
      this.trackRepo.create({
        userId,
        channel: 'web-live',
        duration: 0,
        fileUrl: '',
        status: AudioTrackStatus.PROCESSING,
        fullText: '',
      }),
    );
    this.logger.log(`[${track.id}] live session started`);

    const FLUSH_EVERY = 200; // chars
    let unflushedChars = 0;

    const flushText = async (text: string) => {
      await this.trackRepo.manager.query(
        `UPDATE audio_tracks SET "fullText" = $1 WHERE id = $2`,
        [text, track.id],
      );
    };

    try {
      for await (const delta of this.streaming.transcribeStream(audioStream, { language: lang })) {
        deltas.push(delta);
        unflushedChars += delta.length;
        this.send(client, { type: 'transcript', text: delta });

        if (unflushedChars >= FLUSH_EVERY) {
          unflushedChars = 0;
          void flushText(deltas.join(''));
        }
      }

      this.sessions.delete(client);

      const fullText = deltas.join('');
      const trackId = await this.finalize(track.id, userId, fullText);

      this.send(client, { type: 'done', fullText, trackId });
      client.close();
    } catch (err) {
      this.sessions.delete(client);
      // Save whatever we have so far on error
      const partial = deltas.join('');
      if (partial.trim()) {
        await this.trackRepo.update(track.id, {
          fullText: partial,
          status: AudioTrackStatus.FAILED,
        });
      }
      this.logger.error('Streaming transcription error', err as Error);
      this.send(client, { type: 'error', message: (err as Error).message });
    }
  }

  /** Final save: tags, search vector, embeddings, status=COMPLETED. */
  private async finalize(trackId: string, userId: string, fullText: string): Promise<string> {
    if (!fullText.trim()) return trackId;

    const track = await this.trackRepo.findOneByOrFail({ id: trackId });
    const [summarizeResult, textChunks] = await Promise.all([
      this.summarization.summarize(fullText, SummaryTemplate.Custom, track.createdAt),
      Promise.resolve(chunkTextBySentence(fullText, 800)),
    ]);
    const { tags, eventDate } = summarizeResult;

    await this.trackRepo.manager.query(
      `UPDATE audio_tracks
       SET "fullText" = $1, "searchVector" = to_tsvector('simple', $2), tags = $3, "eventDate" = $4, "tagsProcessed" = TRUE, status = $5
       WHERE id = $6`,
      [this.encryption.encrypt(fullText), fullText, tags, eventDate, AudioTrackStatus.COMPLETED, trackId],
    );

    if (textChunks.length > 0) {
      const vectors = await this.embedding.embed(textChunks);
      const now = new Date();
      await this.chunkRepo.insertMany(
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

    await this.userRepo.increment({ id: userId }, 'freeTracksUsed', 1);
    this.logger.log(`[${trackId}] finalized live transcript (${fullText.length} chars, ${textChunks.length} chunks, tags: ${tags.join(', ')}, eventDate: ${eventDate?.toISOString() ?? 'null'})`);
    return trackId;
  }

  private send(client: WebSocket, event: ServerEvent): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(event));
    }
  }
}
