import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioTrackEntity } from '../audio-track/audio-track.entity';
import { AudioChunkRepository } from '../audio-chunk/audio-chunk.repository';
import { UserModule } from '../user/user.module';
import { StreamingGateway } from './streaming.gateway';
import { WsHmacAuthService } from './ws-hmac-auth.service';
import { LiveTrackService } from './live-track.service';

@Module({
  imports: [UserModule, TypeOrmModule.forFeature([AudioTrackEntity])],
  providers: [StreamingGateway, AudioChunkRepository, WsHmacAuthService, LiveTrackService],
  exports: [WsHmacAuthService, LiveTrackService],
})
export class StreamingModule {}
