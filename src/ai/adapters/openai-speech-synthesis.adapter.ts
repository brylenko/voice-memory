import type OpenAI from 'openai';
import type { SpeechSynthesisPort } from '../ports/speech-synthesis.port';
import { AiAvailabilityService, AiUnavailableError, isQuotaError } from '../ai-availability';

export interface SpeechSynthesisConfig {
  model: string;
  voice: string;
}

const INSTRUCTIONS =
  'You are a smartwatch assistant reading a short answer aloud. Speak naturally, clearly and briskly. ' +
  'The text may mix Russian, Ukrainian and English: pronounce each word in its own language ' +
  '(English words and brand names with English pronunciation).';

/** OpenAI TTS, streamed as raw PCM16 (24 kHz mono) so the watch can play it immediately. */
export class OpenAiSpeechSynthesisAdapter implements SpeechSynthesisPort {
  constructor(
    private readonly client: OpenAI,
    private readonly availability: AiAvailabilityService,
    private readonly cfg: SpeechSynthesisConfig,
  ) {}

  async *stream(text: string): AsyncIterable<Buffer> {
    let res: Response;
    try {
      res = (await this.client.audio.speech.create({
        model: this.cfg.model,
        voice: this.cfg.voice,
        input: text,
        response_format: 'pcm',
        ...(this.cfg.model.startsWith('tts-1') ? {} : { instructions: INSTRUCTIONS }),
      })) as unknown as Response;
    } catch (err) {
      if (isQuotaError(err)) {
        this.availability.markUnavailable();
        throw new AiUnavailableError((err as Error).message);
      }
      throw err;
    }
    if (!res.body) return;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      yield Buffer.from(chunk);
    }
  }
}
