import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { StreamingModule } from '../streaming/streaming.module';
import { AudioChunkRepository } from '../audio-chunk/audio-chunk.repository';
import { AssistantGateway } from './adapters/inbound/ws/assistant.gateway';
import { RagMemoryContextAdapter } from './adapters/outbound/rag-memory-context.adapter';
import { LiveAssistantFactory } from './application/live-assistant.factory';
import { MEMORY_CONTEXT_PORT } from './application/ports/memory-context.port';

/**
 * Real-time "answer mode": listen → split into utterances → stream short
 * answers back. Composition root for the assistant hexagon.
 */
@Module({
  imports: [UserModule, StreamingModule],
  providers: [
    AssistantGateway,
    LiveAssistantFactory,
    AudioChunkRepository,
    { provide: MEMORY_CONTEXT_PORT, useClass: RagMemoryContextAdapter },
  ],
})
export class AssistantModule {}
