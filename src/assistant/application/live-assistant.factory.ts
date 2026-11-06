import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CHAT_STREAM_PORT, ChatStreamPort } from '../../ai/ports/chat-stream.port';
import {
  AssistantEvent,
  LiveAssistantContext,
  LiveAssistantSession,
} from './live-assistant.session';
import { MEMORY_CONTEXT_PORT, MemoryContextPort } from './ports/memory-context.port';
import { MEMORY_RECALL_PORT, MemoryRecallPort } from './ports/memory-recall.port';

/**
 * Factory (GoF) that wires singleton ports into short-lived, per-connection
 * LiveAssistantSession objects. Keeps the session itself free of Nest DI.
 */
@Injectable()
export class LiveAssistantFactory {
  private readonly logger = new Logger('LiveAssistant');

  constructor(
    @Inject(CHAT_STREAM_PORT) private readonly chat: ChatStreamPort,
    @Optional() @Inject(MEMORY_CONTEXT_PORT) private readonly memory: MemoryContextPort | null,
    @Optional() @Inject(MEMORY_RECALL_PORT) private readonly recall: MemoryRecallPort | null,
    private readonly config: ConfigService,
  ) {}

  create(ctx: LiveAssistantContext, emit: (event: AssistantEvent) => void): LiveAssistantSession {
    const useMemory = this.config.get<boolean>('assistant.memoryLookup') ?? true;
    return new LiveAssistantSession(
      {
        chat: this.chat,
        memory: useMemory ? this.memory : null,
        recall: useMemory ? this.recall : null,
        log: (msg) => this.logger.warn(msg),
        trace: (msg) => this.logger.log(msg),
        ...(this.config.get<boolean>('assistant.debugLogText') ? { debugText: (msg: string) => this.logger.log(`[debug-text] ${msg}`) } : {}),
      },
      ctx,
      emit,
    );
  }
}
