import { Global, Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { TRANSCRIPTION_PORT } from './ports/transcription.port';
import { EMBEDDING_PORT } from './ports/embedding.port';
import { CHAT_COMPLETION_PORT } from './ports/chat-completion.port';
import { SUMMARIZATION_PORT } from './ports/summarization.port';
import { INTENT_CLASSIFIER_PORT } from './ports/intent-classifier.port';
import { STREAMING_TRANSCRIPTION_PORT } from './ports/streaming-transcription.port';
import { OpenAiTranscriptionAdapter } from './adapters/openai-transcription.adapter';
import { OpenAiEmbeddingAdapter } from './adapters/openai-embedding.adapter';
import { OpenAiChatCompletionAdapter } from './adapters/openai-chat-completion.adapter';
import { OpenAiSummarizationAdapter } from './adapters/openai-summarization.adapter';
import { OpenAiIntentClassifierAdapter } from './adapters/openai-intent-classifier.adapter';
import { OpenAiStreamingTranscriptionAdapter } from './adapters/openai-streaming-transcription.adapter';
import { UTTERANCE_TRANSCRIPTION_PORT } from './ports/utterance-transcription.port';
import { CHAT_STREAM_PORT } from './ports/chat-stream.port';
import { OpenAiUtteranceTranscriptionAdapter } from './adapters/openai-utterance-transcription.adapter';
import { OpenAiChatStreamAdapter } from './adapters/openai-chat-stream.adapter';
import { AiAvailabilityService } from './ai-availability';
import { OpenAiQuotaProbe } from './adapters/openai-quota-probe';
import { OpenAiWebSearchChatStreamAdapter } from './adapters/openai-web-search-chat-stream.adapter';
import { ConfigService } from '@nestjs/config';
import { OpenAiService } from '../common/services/openai.service';

@Global()
@Module({
  imports: [CommonModule],
  providers: [
    { provide: TRANSCRIPTION_PORT, useClass: OpenAiTranscriptionAdapter },
    { provide: EMBEDDING_PORT, useClass: OpenAiEmbeddingAdapter },
    { provide: CHAT_COMPLETION_PORT, useClass: OpenAiChatCompletionAdapter },
    { provide: SUMMARIZATION_PORT, useClass: OpenAiSummarizationAdapter },
    { provide: INTENT_CLASSIFIER_PORT, useClass: OpenAiIntentClassifierAdapter },
    { provide: STREAMING_TRANSCRIPTION_PORT, useClass: OpenAiStreamingTranscriptionAdapter },
    { provide: UTTERANCE_TRANSCRIPTION_PORT, useClass: OpenAiUtteranceTranscriptionAdapter },
    OpenAiChatStreamAdapter,
    {
      // Strategy: assistant answers with web search (current prices, news...) unless disabled.
      provide: CHAT_STREAM_PORT,
      inject: [ConfigService, OpenAiService, AiAvailabilityService, OpenAiChatStreamAdapter],
      useFactory: (
        config: ConfigService,
        openai: OpenAiService,
        availability: AiAvailabilityService,
        plain: OpenAiChatStreamAdapter,
      ) => config.get<boolean>('assistant.webSearch')
        ? new OpenAiWebSearchChatStreamAdapter(openai.client, availability, {
          model: 'gpt-4o-mini',
          toolType: config.get<string>('assistant.webSearchTool') ?? 'web_search',
          country: config.get<string>('assistant.searchCountry') || undefined,
        })
        : plain,
    },
    { provide: AiAvailabilityService, useFactory: () => new AiAvailabilityService() },
    {
      provide: OpenAiQuotaProbe,
      inject: [OpenAiService, AiAvailabilityService],
      useFactory: (openai: OpenAiService, availability: AiAvailabilityService) => new OpenAiQuotaProbe(openai, availability),
    },
  ],
  exports: [TRANSCRIPTION_PORT, EMBEDDING_PORT, CHAT_COMPLETION_PORT, SUMMARIZATION_PORT, INTENT_CLASSIFIER_PORT, STREAMING_TRANSCRIPTION_PORT,
    UTTERANCE_TRANSCRIPTION_PORT, CHAT_STREAM_PORT, AiAvailabilityService, OpenAiQuotaProbe],
})
export class AiModule {}
