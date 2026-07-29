import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import type { Readable } from 'stream';
import type {
  StreamingTranscriptionPort,
  StreamingTranscriptionOptions,
} from '../ports/streaming-transcription.port';

const REALTIME_URL = `wss://api.openai.com/v1/realtime?intent=transcription`;

@Injectable()
export class OpenAiStreamingTranscriptionAdapter implements StreamingTranscriptionPort {
  private readonly logger = new Logger(OpenAiStreamingTranscriptionAdapter.name);
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('openaiApiKey') ?? '';
  }

  async *transcribeStream(
    audioStream: Readable,
    options: StreamingTranscriptionOptions = {},
  ): AsyncIterable<string> {
    const { language } = options;

    type QueueItem =
      | { type: 'delta'; text: string }
      | { type: 'done' }
      | { type: 'error'; err: Error };

    const queue: QueueItem[] = [];
    let notify: (() => void) | null = null;
    const push = (item: QueueItem) => { queue.push(item); notify?.(); notify = null; };
    const wait = () => new Promise<void>((r) => { notify = r; });

    const ws = new WebSocket(REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    let sessionReady = false;
    const audioBuffer: Buffer[] = [];
    let audioEnded = false;
    let committed = false;
    let pendingCommits = 0;

    audioStream.on('data', (chunk: Buffer) => {
      if (sessionReady && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: chunk.toString('base64'),
        }));
      } else {
        audioBuffer.push(chunk);
      }
    });

    audioStream.on('end', () => {
      audioEnded = true;
      if (sessionReady && ws.readyState === WebSocket.OPEN && !committed) {
        committed = true;
        this.commitAudio(ws);
        pendingCommits++;
      }
    });

    audioStream.on('error', (err) => push({ type: 'error', err }));

    ws.on('open', () => {
      this.logger.log('→ Realtime transcription WS open');
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: {
                type: 'audio/pcm',
                rate: 24000,
              },
              transcription: {
                model: 'gpt-realtime-whisper',
                ...(language ? { language } : {}),
              },
              turn_detection: null,
            },
          },
        },
      }));
    });

    ws.on('message', (raw) => {
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw.toString()) as Record<string, unknown>; }
      catch { return; }

      const t = event.type as string;
      this.logger.debug(`← ${t}`);

      if (t === 'session.created' || t === 'session.updated') {
        sessionReady = true;
        for (const chunk of audioBuffer) {
          ws.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: chunk.toString('base64'),
          }));
        }
        audioBuffer.length = 0;
        if (audioEnded && !committed) { committed = true; this.commitAudio(ws); pendingCommits++; }

      } else if (t === 'conversation.item.input_audio_transcription.delta') {
        const delta = (event.delta as string) ?? '';
        if (delta) push({ type: 'delta', text: delta });

      } else if (t === 'conversation.item.input_audio_transcription.completed') {
        pendingCommits--;
        if (audioEnded && pendingCommits <= 0) {
          this.logger.log('← all turns completed, closing WS');
          ws.close();
        }

      } else if (t === 'error') {
        const err = event.error as Record<string, string>;
        if (err?.code === 'input_audio_buffer_commit_empty') return;
        this.logger.error(`← error: ${JSON.stringify(err)}`);
        push({ type: 'error', err: new Error(err?.message ?? 'Realtime error') });
        ws.close();
      }
    });

    ws.on('error', (err) => { this.logger.error('WS error', err); push({ type: 'error', err }); });
    ws.on('close', () => { this.logger.log('← WS closed'); push({ type: 'done' }); });

    while (true) {
      if (queue.length === 0) await wait();
      const item = queue.shift()!;
      if (item.type === 'delta') yield item.text;
      else if (item.type === 'error') throw item.err;
      else return;
    }
  }

  private commitAudio(ws: WebSocket): void {
    ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    this.logger.log('→ audio committed');
  }
}
