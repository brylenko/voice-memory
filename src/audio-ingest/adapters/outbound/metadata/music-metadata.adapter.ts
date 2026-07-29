import { Injectable } from '@nestjs/common';
import { parseBuffer } from 'music-metadata';
import {
  AudioMetadataInput,
  AudioMetadataPort,
} from '../../../application/ports/outbound/audio-metadata.port';

@Injectable()
export class MusicMetadataAdapter implements AudioMetadataPort {
  async getDurationSeconds(input: AudioMetadataInput): Promise<number> {
    const metadata = await parseBuffer(input.buffer, undefined, { duration: true });
    return Math.round(metadata.format.duration ?? 0);
  }
}
