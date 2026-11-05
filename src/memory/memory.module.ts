import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioTrackEntity } from '../audio-track/audio-track.entity';
import { DeviceAuthGuard } from '../audio-ingest/adapters/inbound/http/device-auth.guard';
import { UserModule } from '../user/user.module';
import { DayDigestService } from './day-digest.service';
import { MemoryController } from './memory.controller';

@Module({
  imports: [UserModule, TypeOrmModule.forFeature([AudioTrackEntity])],
  controllers: [MemoryController],
  providers: [DayDigestService, DeviceAuthGuard],
})
export class MemoryModule {}
