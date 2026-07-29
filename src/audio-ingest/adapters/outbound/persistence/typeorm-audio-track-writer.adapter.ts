import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AudioTrackEntity, AudioTrackStatus } from '../../../../audio-track/audio-track.entity';
import {
  AudioTrackWriterPort,
  CreateTrackInput,
} from '../../../application/ports/outbound/audio-track-writer.port';

@Injectable()
export class TypeOrmAudioTrackWriterAdapter implements AudioTrackWriterPort {
  constructor(
    @InjectRepository(AudioTrackEntity)
    private readonly trackRepo: Repository<AudioTrackEntity>,
  ) {}

  async createInitialized(input: CreateTrackInput): Promise<AudioTrackEntity> {
    const track = this.trackRepo.create({
      userId: input.userId,
      channel: input.channel,
      duration: input.duration,
      fileUrl: input.storageKey,
      status: AudioTrackStatus.INITIALIZED,
      telegramChatId: input.telegramChatId ?? null,
      telegramMessageId: input.telegramMessageId ?? null,
    });
    return this.trackRepo.save(track);
  }

  async findById(trackId: string): Promise<AudioTrackEntity | null> {
    return this.trackRepo.findOneBy({ id: trackId });
  }
}
