import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchController } from './rag.controller';
import { RagService } from './rag.service';
import { AudioChunkRepository } from '../audio-chunk/audio-chunk.repository';
import { AiModule } from '../ai/ai.module';
import { UserEntity } from '../user/user.entity';
import { DeviceAuthGuard } from '../audio-ingest/adapters/inbound/http/device-auth.guard';

@Module({
  imports: [AiModule, TypeOrmModule.forFeature([UserEntity])],
  controllers: [SearchController],
  providers: [RagService, AudioChunkRepository, DeviceAuthGuard],
  exports: [RagService],
})
export class RagModule {}
