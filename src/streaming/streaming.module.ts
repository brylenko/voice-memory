import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioTrackEntity } from '../audio-track/audio-track.entity';
import { AudioChunkRepository } from '../audio-chunk/audio-chunk.repository';
import { StreamingGateway } from './streaming.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([AudioTrackEntity])],
  providers: [StreamingGateway, AudioChunkRepository],
})
export class StreamingModule {}
