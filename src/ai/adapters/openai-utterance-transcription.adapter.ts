import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import type { Readable } from 'stream';
import { AsyncQueue } from '../../common/services/async-queue';
import { AiAvailabilityService, AiUnavailableError, isQuotaError } from '../ai-availability';
import type {
  UtteranceEvent,
  UtteranceTranscriptionOptions,
  UtteranceTranscriptionPort,
} from '../ports/utterance-transcription.port';

const REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
/** After the client says "end", wait at most this long for the last turn's transcript. */
const DRAIN_TIMEOUT_MS = 5_000;

/**
 * OpenAI Realtime transcription session with server-side VAD: the API itself
 * cuts the audio into turns and emits one `completed` transcript per turn,
 * which maps 1:1 onto our `final` utterance event.
 *
 * Audio contract: PCM16 mono 24 kHz (same as StreamingGateway).
 */
@Injectable()
export class OpenAiUtteranceTranscriptionAdapter implements UtteranceTranscriptionPort {
  private readonly logger = new Logger(OpenAiUtteranceTranscriptionAdapter.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ConfigService, private readonly availability: AiAvailabilityService) {
    this.apiKey = config.get<string>('openaiApiKey') ?? '';
    // Must be a model that supports server-side turn detection: gpt-realtime-whisper
    // rejects `turn_detection` ("Turn detection is not supported for this transcription model").
    this.model = config.get<string>('realtimeVadTranscriptionModel') ?? 'gpt-4o-transcribe';
  }

  transcribeUtterances(
    audioStream: Readable,
    options: UtteranceTranscriptionOptions = {},
  ): AsyncIterable<UtteranceEvent> {
    const queue = new AsyncQueue<UtteranceEvent>();
    const partials = new Map<string, string>();
    const seenTypes = new Set<string>();
    const pendingAudio: Buffer[] = [];
    let ready = false;
    let drainTimer: NodeJS.Timeout | null = null;

    const ws = new WebSocket(REALTIME_URL, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    const sendAudio = (chunk: Buffer) =>
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') }));

    const close = () => {
      if (drainTimer) clearTimeout(drainTimer);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      queue.end();
    };

    const beginDrain = () => {
      if (drainTimer) return;
      if (ws.readyState === WebSocket.OPEN) {
        // Flush whatever is left in the buffer as a final turn; an empty buffer
        // yields `input_audio_buffer_commit_empty`, handled below.
        ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      }
      drainTimer = setTimeout(close, DRAIN_TIMEOUT_MS);
    };

    audioStream.on('data', (chunk: Buffer) => {
      if (ready && ws.readyState === WebSocket.OPEN) sendAudio(chunk);
      else pendingAudio.push(chunk);
    });
    audioStream.on('end', () => { if (ready) beginDrain(); });
    audioStream.on('error', (err) => { queue.fail(err); close(); });

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              noise_reduction: { type: 'far_field' },
              transcription: {
                model: this.model,
                ...(options.language ? { language: options.language } : {}),
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: options.silenceMs ?? 600,
              },
            },
          },
        },
      }));
    });

    ws.on('message', (raw) => {
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw.toString()) as Record<string, unknown>; } catch { return; }
      const type = event.type as string;
      const itemId = (event.item_id as string | undefined) ?? '';

      switch (type) {
        case 'session.created':
        case 'session.updated':
          this.logger.log(`← ${type} (model=${this.model})`);
          if (ready) return;
          ready = true;
          for (const chunk of pendingAudio) sendAudio(chunk);
          pendingAudio.length = 0;
          if (audioStream.readableEnded) beginDrain();
          return;

        case 'input_audio_buffer.speech_started':
        case 'input_audio_buffer.speech_stopped':
        case 'input_audio_buffer.committed':
          this.logger.log(`← ${type}`);
          return;

        case 'conversation.item.input_audio_transcription.failed': {
          // Transcription of one turn failed (bad audio, model/permission issue...). Surface the reason.
          const err = event.error as { code?: string; message?: string } | undefined;
          this.logger.error(`← transcription failed: ${JSON.stringify(err)}`);
          partials.delete(itemId);
          if (isQuotaError(err)) {
            this.availability.markUnavailable();
            queue.fail(new AiUnavailableError(err?.message));
            close();
          }
          return;
        }

        case 'conversation.item.input_audio_transcription.delta': {
          const text = (partials.get(itemId) ?? '') + ((event.delta as string) ?? '');
          partials.set(itemId, text);
          queue.push({ type: 'partial', utteranceId: itemId, text });
          return;
        }

        case 'conversation.item.input_audio_transcription.completed': {
          const text = ((event.transcript as string) ?? partials.get(itemId) ?? '').trim();
          partials.delete(itemId);
          // Length only — never log what the user said.
          this.logger.log(`← utterance completed (${text.length} chars)`);
          if (text) queue.push({ type: 'final', utteranceId: itemId, text });
          if (drainTimer) close();
          return;
        }

        default:
          if (!seenTypes.has(type)) {
            seenTypes.add(type);
            this.logger.log(`← (unhandled) ${type}`);
          }
          return;

        case 'error': {
          const err = event.error as { code?: string; message?: string } | undefined;
          if (err?.code === 'input_audio_buffer_commit_empty') {
            if (drainTimer) close();
            return;
          }
          this.logger.error(`Realtime error: ${JSON.stringify(err)}`);
          if (isQuotaError(err)) {
            this.availability.markUnavailable();
            queue.fail(new AiUnavailableError(err?.message));
          } else {
            queue.fail(new Error(err?.message ?? 'Realtime transcription error'));
          }
          close();
          return;
        }
      }
    });

    let audioBytes = 0;
    audioStream.on('data', (chunk: Buffer) => { audioBytes += chunk.length; });

    // Handshake refused (e.g. HTTP 429 when the account has no credits) never reaches 'message'.
    ws.on('unexpected-response', (_req, res) => {
      const status = res.statusCode ?? 0;
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString(); });
      res.on('end', () => {
        this.logger.error(`Realtime handshake rejected: HTTP ${status}`);
        if (status === 429 && (body.includes('insufficient_quota') || body.includes('credit_balance_exhausted'))) {
          this.availability.markUnavailable();
          queue.fail(new AiUnavailableError());
        } else {
          queue.fail(new Error(`Realtime handshake rejected: HTTP ${status}`));
        }
        close();
      });
    });
    ws.on('error', (err) => { this.logger.error(`Realtime WS error: ${err.message}`); queue.fail(err); close(); });
    ws.on('close', (code, reason) => {
      this.logger.log(`← Realtime WS closed (code=${code}${reason.length ? `, reason=${reason.toString()}` : ''}, audio received=${Math.round(audioBytes / 48_000)}s)`);
      queue.end();
    });

    return queue;
  }
}
