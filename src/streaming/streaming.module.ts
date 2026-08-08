import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioTrackEntity } from '../audio-track/audio-track.entity';
import { AudioChunkRepository } from '../audio-chunk/audio-chunk.repository';
import { StreamingGateway } from './streaming.gateway';
import { WsHmacAuthService } from './ws-hmac-auth.service';
import { UserEntity } from '../user/user.entity';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([AudioTrackEntity, UserEntity])],
  providers: [StreamingGateway, AudioChunkRepository, WsHmacAuthService],
})
export class StreamingModule {}
