import { Inject, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { Readable } from 'stream';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import {
  STREAMING_TRANSCRIPTION_PORT,
  StreamingTranscriptionPort,
} from '../ai/ports/streaming-transcription.port';
import { DeviceUserResolver } from '../user/device-user.resolver';
import { LiveTrackService } from './live-track.service';
import { WsHmacAuthService, WsAuthError } from './ws-hmac-auth.service';

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
 * Required query params (HMAC authentication — same scheme as HTTP DeviceAuthGuard):
 *   deviceId  — device serial number
 *   ts        — unix seconds (integer)
 *   nonce     — random unique string per connection (replay protection)
 *   sig       — hex HMAC-SHA256( `${deviceId}.${ts}.${nonce}`, DEVICE_HMAC_SECRET )
 *
 * Optional query params:
 *   lang      — BCP-47 language hint, e.g. "uk", "en"
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
    private readonly users: DeviceUserResolver,
    private readonly liveTracks: LiveTrackService,
    private readonly wsAuth: WsHmacAuthService,
  ) {}

  handleConnection(client: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const lang = url.searchParams.get('lang') ?? undefined;

    // Validate HMAC credentials before doing anything else.
    // Uses the same scheme as HTTP DeviceAuthGuard: HMAC-SHA256(deviceId.ts.nonce, secret).
    // Nonce prevents replay; timestamp window prevents delayed-capture attacks.
    let externalId: string;
    try {
      externalId = this.wsAuth.validate(url.searchParams);
    } catch (err) {
      const reason = err instanceof WsAuthError ? err.reason : 'Authentication failed';
      this.logger.warn(`WS auth rejected: ${reason}`);
      client.close(1008, reason);
      return;
    }

    this.logger.log(`Client authenticated (deviceId=***${externalId.slice(-4)})`);

    const audioPassthrough = new Readable({ read() {} });
    this.sessions.set(client, audioPassthrough);
    const deltas: string[] = [];

    // Authorization state machine: buffer incoming audio frames until resolveUser
    // completes. This guarantees no audio is pushed to OpenAI before auth succeeds.
    type AuthState = 'pending' | 'authorized' | 'rejected';
    let authState: AuthState = 'pending';
    const pendingFrames: Buffer[] = [];

    client.on('message', (data, isBinary) => {
      if (isBinary) {
        if (authState === 'rejected') return;

        if (authState === 'pending') {
          pendingFrames.push(data as Buffer);
          if (pendingFrames.length === 1) {
            // First frame — kick off auth once; subsequent frames just buffer.
            void this.users.resolve(externalId).then(({ id: userId, blocked }) => {
              if (blocked) {
                authState = 'rejected';
                pendingFrames.length = 0;
                this.send(client, {
                  type: 'error',
                  message: 'Free quota exceeded. Please upgrade to continue.',
                  paymentUrl: this.users.paymentUrl,
                });
                client.close();
                return;
              }
              // Auth succeeded — flush buffered frames then start session.
              authState = 'authorized';
              for (const frame of pendingFrames) audioPassthrough.push(frame);
              pendingFrames.length = 0;
              void this.runSession(client, audioPassthrough, deltas, userId, lang);
            }).catch((err: Error) => {
              authState = 'rejected';
              pendingFrames.length = 0;
              this.logger.error(`resolveUser failed: ${err.message}`);
              this.send(client, { type: 'error', message: 'Authorization failed' });
              client.close();
            });
          }
          return;
        }

        // authState === 'authorized'
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
    const trackId = await this.liveTracks.start(userId, 'web-live');
    this.logger.log(`[${trackId}] live session started`);

    const FLUSH_EVERY = 200; // chars
    let unflushedChars = 0;

    try {
      for await (const delta of this.streaming.transcribeStream(audioStream, { language: lang })) {
        deltas.push(delta);
        unflushedChars += delta.length;
        this.send(client, { type: 'transcript', text: delta });

        if (unflushedChars >= FLUSH_EVERY) {
          unflushedChars = 0;
          this.liveTracks.savePartial(trackId, deltas.join('')).catch((err: Error) =>
            this.logger.error(`[${trackId}] partial text flush failed: ${err.message}`),
          );
        }
      }

      this.sessions.delete(client);
      const fullText = deltas.join('');
      await this.liveTracks.finalize(trackId, userId, fullText);
      this.send(client, { type: 'done', fullText, trackId });
      client.close();
    } catch (err) {
      this.sessions.delete(client);
      await this.liveTracks.markFailed(trackId, deltas.join(''));
      this.logger.error('Streaming transcription error', err as Error);
      this.send(client, { type: 'error', message: (err as Error).message });
    }
  }

  private send(client: WebSocket, event: ServerEvent): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(event));
    }
  }
}
