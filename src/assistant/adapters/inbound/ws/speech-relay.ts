import type { SpeechSynthesisPort } from '../../../../ai/ports/speech-synthesis.port';
import { SPEECH_PCM_FORMAT } from '../../../../ai/ports/speech-synthesis.port';
import { aiErrorCode } from '../../../../ai/ai-availability';

export type SpeechEvent =
  | { type: 'speech.start'; id: string; encoding: string; sampleRate: number; channels: number }
  | { type: 'speech.end'; id: string; interrupted?: boolean }
  | { type: 'speech.error'; id: string; code?: 'ai_unavailable' };

/**
 * Per-connection bridge: answer text → synthesized PCM → WebSocket binary frames,
 * framed by `speech.start` / `speech.end` JSON events. A newer answer interrupts the
 * one being spoken (the watch should hear the latest, not a backlog).
 */
export class SpeechRelay {
  enabled = false;
  private current: { id: string; cancelled: boolean } | null = null;

  constructor(
    private readonly tts: SpeechSynthesisPort,
    private readonly sendEvent: (e: SpeechEvent) => void,
    private readonly sendAudio: (pcm: Buffer) => void,
    private readonly log: (msg: string) => void = () => undefined,
  ) {}

  /** Fire-and-forget; resolves when this utterance finished or was interrupted. */
  speak(id: string, text: string): Promise<void> {
    if (!this.enabled || !text.trim()) return Promise.resolve();
    this.stop();
    const job = { id, cancelled: false };
    this.current = job;
    return this.run(job, text);
  }

  stop(): void {
    if (this.current) this.current.cancelled = true;
    this.current = null;
  }

  private async run(job: { id: string; cancelled: boolean }, text: string): Promise<void> {
    this.sendEvent({ type: 'speech.start', id: job.id, ...SPEECH_PCM_FORMAT });
    let carry: Buffer | null = null; // PCM16 needs even-sized frames; HTTP chunks may be odd
    try {
      for await (const chunk of this.tts.stream(text)) {
        if (job.cancelled) break;
        let data = carry ? Buffer.concat([carry, chunk]) : chunk;
        carry = null;
        if (data.length % 2 === 1) {
          carry = data.subarray(data.length - 1);
          data = data.subarray(0, data.length - 1);
        }
        if (data.length) this.sendAudio(data);
      }
      this.sendEvent({ type: 'speech.end', id: job.id, ...(job.cancelled ? { interrupted: true } : {}) });
    } catch (err) {
      this.log(`speech synthesis failed: ${(err as Error).message}`);
      const code = aiErrorCode(err);
      this.sendEvent({ type: 'speech.error', id: job.id, ...(code ? { code } : {}) });
    } finally {
      if (this.current === job) this.current = null;
    }
  }
}
