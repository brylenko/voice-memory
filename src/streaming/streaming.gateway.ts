import { Inject, Logger } from '@nestjs/common';
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
import { TAGGING_PORT, TaggingPort } from '../ai/ports/tagging.port';
import { AudioTrackEntity, AudioTrackStatus } from '../audio-track/audio-track.entity';
import { AudioChunkRepository } from '../audio-chunk/audio-chunk.repository';
import { chunkTextBySentence, dayOfWeekOf } from '../common/services/text-chunker.util';

interface TranscriptDelta { type: 'transcript'; text: string; }
interface DoneEvent       { type: 'done'; fullText: string; trackId: string; }
interface ErrorEvent      { type: 'error'; message: string; }
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
 *   userId — UUID from the users table (required)
 *   lang   — BCP-47 language hint, e.g. "uk", "en" (optional)
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
    @Inject(TAGGING_PORT)
    private readonly tagging: TaggingPort,
    @InjectRepository(AudioTrackEntity)
    private readonly trackRepo: Repository<AudioTrackEntity>,
    private readonly chunkRepo: AudioChunkRepository,
  ) {}

  handleConnection(client: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const userId = url.searchParams.get('userId') ?? 'anonymous';
    const lang   = url.searchParams.get('lang') ?? undefined;

    this.logger.log(`Client connected (userId=${userId})`);

    const audioPassthrough = new Readable({ read() {} });
    this.sessions.set(client, audioPassthrough);
    let audioStarted = false;
    const deltas: string[] = [];

    client.on('message', (data, isBinary) => {
      if (isBinary) {
        if (!audioStarted) {
          audioStarted = true;
          void this.runSession(client, audioPassthrough, deltas, userId, lang);
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
    if (userId === 'anonymous') return;

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

    const [tags, textChunks] = await Promise.all([
      this.tagging.extractTags(fullText),
      Promise.resolve(chunkTextBySentence(fullText, 800)),
    ]);

    await this.trackRepo.manager.query(
      `UPDATE audio_tracks
       SET "fullText" = $1, "searchVector" = to_tsvector('simple', $1), tags = $2, status = $3
       WHERE id = $4`,
      [fullText, tags, AudioTrackStatus.COMPLETED, trackId],
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

    this.logger.log(`[${trackId}] finalized live transcript (${fullText.length} chars, ${textChunks.length} chunks, tags: ${tags.join(', ')})`);
    return trackId;
  }

  private send(client: WebSocket, event: ServerEvent): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(event));
    }
  }
}
