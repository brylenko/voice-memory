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
  ],
  exports: [TRANSCRIPTION_PORT, EMBEDDING_PORT, CHAT_COMPLETION_PORT, SUMMARIZATION_PORT, INTENT_CLASSIFIER_PORT, STREAMING_TRANSCRIPTION_PORT],
})
export class AiModule {}
