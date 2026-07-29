import { Injectable, Logger } from '@nestjs/common';
import { toFile } from 'openai/uploads';
import { OpenAiService } from '../../common/services/openai.service';
import { TranscriptionPort } from '../ports/transcription.port';

@Injectable()
export class OpenAiTranscriptionAdapter implements TranscriptionPort {
  private readonly logger = new Logger(OpenAiTranscriptionAdapter.name);

  constructor(private readonly openai: OpenAiService) {}

  async transcribe(audioBuffer: Buffer, fileNameHint?: string): Promise<string> {
    const normalizedName = (fileNameHint ?? 'audio.ogg').replace(/\.oga$/, '.ogg');
    this.logger.log(`→ OpenAI transcriptions.create model=gpt-4o-mini-transcribe file=${normalizedName} size=${audioBuffer.length}b`);
    const file = await toFile(audioBuffer, normalizedName);
    const transcription = await this.openai.client.audio.transcriptions.create({
      file,
      model: 'gpt-4o-mini-transcribe',
    });
    this.logger.log(`← transcription received: ${transcription.text.length} chars`);
    return transcription.text;
  }
}
