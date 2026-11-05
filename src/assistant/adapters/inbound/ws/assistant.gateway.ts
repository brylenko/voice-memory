import { Inject, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import { WebSocket } from 'ws';
import { Readable } from 'stream';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import {
  UTTERANCE_TRANSCRIPTION_PORT,
  UtteranceTranscriptionPort,
} from '../../../../ai/ports/utterance-transcription.port';
import { DeviceUserResolver } from '../../../../user/device-user.resolver';
import { LiveTrackService } from '../../../../streaming/live-track.service';
import { WsAuthError, WsHmacAuthService } from '../../../../streaming/ws-hmac-auth.service';
import { LiveAssistantFactory } from '../../../application/live-assistant.factory';
import type {
  AssistantEvent,
  AssistantMode,
  LiveAssistantSession,
} from '../../../application/live-assistant.session';

type ServerEvent =
  | AssistantEvent
  | { type: 'ready'; mode: AssistantMode }
  | { type: 'partial'; id: string; text: string }
  | { type: 'utterance'; id: string; text: string }
  | { type: 'done'; trackId?: string }
  | { type: 'error'; message: string; paymentUrl?: string };

interface Connection {
  audio: Readable;
  assistant?: LiveAssistantSession;
}

/** Hard cap on buffered pre-auth audio (~10 s of PCM16 @ 24 kHz). */
const MAX_PENDING_BYTES = 24_000 * 2 * 10;

/**
 * Real-time "answer mode" for the Galaxy Watch (or any client):
 * the watch streams microphone audio, the server splits it into utterances,
 * and pushes short answers back the moment something deserves one.
 *
 * Client → server:
 *   binary frames           — PCM16 mono 24 kHz (~100 ms per frame)
 *   {"type":"ask"}          — force an answer about the latest utterance
 *   {"type":"mode","mode":"auto"|"manual"} — switch mode on the fly
 *   "end"                   — stop listening (flush + close)
 *
 * Server → client:
 *   {"type":"ready","mode":"auto"}
 *   {"type":"partial","id","text"}                 — live caption of current utterance
 *   {"type":"utterance","id","text"}               — finished utterance
 *   {"type":"answer.start","id","inReplyTo"}
 *   {"type":"answer.delta","id","text"}
 *   {"type":"answer.done","id","text"}
 *   {"type":"answer.error","id","message"}
 *   {"type":"done","trackId"?}                     — session saved (when save=1)
 *   {"type":"error","message","paymentUrl"?}
 *
 * Query params: HMAC auth (deviceId, ts, nonce, sig — see WsHmacAuthService) plus
 *   mode=auto|manual (default auto), lang=<BCP-47>, save=1 to store the transcript in memory.
 */
@WebSocketGateway({ path: '/assist/live' })
export class AssistantGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AssistantGateway.name);
  private readonly connections = new Map<WebSocket, Connection>();

  constructor(
    @Inject(UTTERANCE_TRANSCRIPTION_PORT) private readonly stt: UtteranceTranscriptionPort,
    private readonly assistants: LiveAssistantFactory,
    private readonly users: DeviceUserResolver,
    private readonly liveTracks: LiveTrackService,
    private readonly wsAuth: WsHmacAuthService,
  ) {}

  handleConnection(client: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    let deviceId: string;
    try {
      deviceId = this.wsAuth.validate(url.searchParams);
    } catch (err) {
      const reason = err instanceof WsAuthError ? err.reason : 'Authentication failed';
      this.logger.warn(`WS auth rejected: ${reason}`);
      client.close(1008, reason);
      return;
    }

    const mode: AssistantMode = url.searchParams.get('mode') === 'manual' ? 'manual' : 'auto';
    const lang = url.searchParams.get('lang') ?? undefined;
    const save = url.searchParams.get('save') === '1';

    const conn: Connection = { audio: new Readable({ read() {} }) };
    this.connections.set(client, conn);

    // Audio arriving before the user is resolved is buffered (bounded), never sent upstream.
    const pending: Buffer[] = [];
    let pendingBytes = 0;
    let authorized = false;

    client.on('message', (data, isBinary) => {
      if (isBinary) {
        const frame = data as Buffer;
        if (authorized) {
          conn.audio.push(frame);
        } else if (pendingBytes + frame.length <= MAX_PENDING_BYTES) {
          pending.push(frame);
          pendingBytes += frame.length;
        }
        return;
      }
      this.handleControl(conn, (data as Buffer).toString());
    });

    this.users.resolve(deviceId)
      .then(({ id: userId, blocked }) => {
        if (client.readyState !== WebSocket.OPEN) return;
        if (blocked) {
          this.send(client, {
            type: 'error',
            message: 'Free quota exceeded. Please upgrade to continue.',
            paymentUrl: this.users.paymentUrl,
          });
          client.close();
          return;
        }
        conn.assistant = this.assistants.create({ userId, mode }, (e) => this.send(client, e));
        authorized = true;
        for (const frame of pending) conn.audio.push(frame);
        pending.length = 0;
        this.send(client, { type: 'ready', mode });
        void this.runSession(client, conn, userId, { lang, save });
      })
      .catch((err: Error) => {
        this.logger.error(`resolveUser failed: ${err.message}`);
        this.send(client, { type: 'error', message: 'Authorization failed' });
        client.close();
      });
  }

  handleDisconnect(client: WebSocket): void {
    const conn = this.connections.get(client);
    if (!conn) return;
    conn.assistant?.close();
    conn.audio.push(null);
    this.connections.delete(client);
  }

  private handleControl(conn: Connection, raw: string): void {
    if (raw === 'end') {
      conn.audio.push(null);
      return;
    }
    let msg: { type?: string; mode?: string };
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'ask') conn.assistant?.askNow();
    if (msg.type === 'mode' && (msg.mode === 'auto' || msg.mode === 'manual')) {
      conn.assistant?.setMode(msg.mode);
    }
  }

  private async runSession(
    client: WebSocket,
    conn: Connection,
    userId: string,
    opts: { lang?: string; save: boolean },
  ): Promise<void> {
    const transcript: string[] = [];
    this.logger.log(`assistant session started (save=${opts.save})`);
    const trackId = opts.save ? await this.liveTracks.start(userId, 'wear-assist') : undefined;

    try {
      for await (const ev of this.stt.transcribeUtterances(conn.audio, { language: opts.lang })) {
        if (ev.type === 'partial') {
          this.send(client, { type: 'partial', id: ev.utteranceId, text: ev.text });
          continue;
        }
        transcript.push(ev.text);
        this.send(client, { type: 'utterance', id: ev.utteranceId, text: ev.text });
        conn.assistant?.onUtterance(ev.utteranceId, ev.text);
        if (trackId && transcript.length % 5 === 0) {
          this.liveTracks.savePartial(trackId, transcript.join('\n')).catch((err: Error) =>
            this.logger.error(`[${trackId}] partial save failed: ${err.message}`),
          );
        }
      }

      this.logger.log(`assistant session ended (${transcript.length} utterances)`);
      await conn.assistant?.idle();
      if (trackId) await this.liveTracks.finalize(trackId, userId, transcript.join('\n'));
      this.send(client, { type: 'done', trackId });
    } catch (err) {
      this.logger.error('Assistant session error', err as Error);
      if (trackId) await this.liveTracks.markFailed(trackId, transcript.join('\n')).catch(() => undefined);
      this.send(client, { type: 'error', message: 'Live transcription failed' });
    } finally {
      conn.assistant?.close();
      this.connections.delete(client);
      if (client.readyState === WebSocket.OPEN) client.close();
    }
  }

  private send(client: WebSocket, event: ServerEvent): void {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
  }
}
