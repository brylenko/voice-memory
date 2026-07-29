import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioTrackEntity } from '../audio-track/audio-track.entity';
import { AudioChunkRepository } from '../audio-chunk/audio-chunk.repository';
import { StreamingGateway } from './streaming.gateway';
import { UserEntity } from '../user/user.entity';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([AudioTrackEntity, UserEntity])],
  providers: [StreamingGateway, AudioChunkRepository],
})
export class StreamingModule {}
