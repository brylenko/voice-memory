import { Body, Controller, HttpCode, HttpStatus, Inject, Logger, Post, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramWebhookGuard } from './telegram-webhook.guard';
import { TelegramApiClient } from './telegram-api.client';
import type { TelegramUpdate } from './telegram-update.types';
import {
  INGEST_AUDIO_USE_CASE,
  IngestAudioUseCase,
} from '../../../application/ports/inbound/ingest-audio.use-case';
import { InsufficientBalanceError } from '../../../application/errors';
import { TRANSCRIPTION_PORT, TranscriptionPort } from '../../../../ai/ports/transcription.port';
import { INTENT_CLASSIFIER_PORT, IntentClassifierPort } from '../../../../ai/ports/intent-classifier.port';
import { RagService } from '../../../../rag/rag.service';
import { UserEntity } from '../../../../user/user.entity';
import { AudioTrackEntity } from '../../../../audio-track/audio-track.entity';
import type { ActionTask } from '../../../../audio-track/audio-track.entity';
import { TasksService } from './tasks.service';

@Controller('telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    @Inject(INGEST_AUDIO_USE_CASE) private readonly ingestAudio: IngestAudioUseCase,
    @Inject(TRANSCRIPTION_PORT) private readonly transcription: TranscriptionPort,
    @Inject(INTENT_CLASSIFIER_PORT) private readonly classifier: IntentClassifierPort,
    private readonly rag: RagService,
    private readonly telegram: TelegramApiClient,
    private readonly tasks: TasksService,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
  ) {}

  @Post('webhook')
  @UseGuards(TelegramWebhookGuard)
  @HttpCode(HttpStatus.OK)
  async handleUpdate(@Body() update: TelegramUpdate): Promise<{ ok: true }> {
    const message = update.message;
    const media = message?.voice ?? message?.audio;

    if (!message || !media || !message.from) {
      return { ok: true };
    }

    const chatId = message.chat.id;
    const telegramId = String(message.from.id);

    try {
      this.logger.log(`[tg=${telegramId}] voice received: file_id=${media.file_id} duration=${media.duration}s`);

      const userId = await this.resolveUserId(telegramId);

      const filePath = await this.telegram.getFilePath(media.file_id);
      const audioBuffer = await this.telegram.downloadFile(filePath);
      const fileNameFromTelegram = (media as { file_name?: string }).file_name;
      const suggestedFileName = fileNameFromTelegram ?? filePath.split('/').pop() ?? 'voice.ogg';
      this.logger.log(`[tg=${telegramId}] downloaded ${audioBuffer.length} bytes as ${suggestedFileName}`);

      const text = await this.transcription.transcribe(audioBuffer, suggestedFileName);
      this.logger.log(`[tg=${telegramId}] transcribed (${text.length} chars)`);

      const intent = await this.classifier.classify(text);
      this.logger.log(`[tg=${telegramId}] intent=${JSON.stringify(intent)}`);

      if (intent.kind === 'search_query') {
        await this.handleSearchQuery(chatId, userId, text, message.message_id);
      } else if (intent.kind === 'list_tasks') {
        await this.handleListTasks(chatId, userId, message.message_id);
      } else if (intent.kind === 'mark_task_done') {
        await this.handleMarkTaskDone(chatId, userId, intent.taskHint, message.message_id);
      } else {
        await this.handleRecording(chatId, userId, audioBuffer, suggestedFileName, media.duration, text, intent.recordingType, message.message_id);
      }
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        await this.telegram.sendMessage(chatId, `Не хватає хвилин на балансі: ${error.message}`);
      } else {
        this.logger.error(`[tg=${telegramId}] failed to handle voice message`, error as Error);
        await this.telegram.sendMessage(chatId, 'Не вдалося обробити запис, спробуй ще раз.');
      }
    }

    return { ok: true };
  }

  /** Resolve or create the canonical user UUID for a given Telegram user ID. */
  private async resolveUserId(telegramId: string): Promise<string> {
    let user = await this.userRepo.findOneBy({ telegramId });
    if (!user) {
      user = await this.userRepo.save(this.userRepo.create({ telegramId }));
      this.logger.log(`[tg=${telegramId}] created new user row: ${user.id}`);
    }
    return user.id;
  }

  private async handleSearchQuery(chatId: number, userId: string, query: string, replyToMessageId: number): Promise<void> {
    this.logger.log(`[user=${userId}] routing to RAG search: "${query}"`);
    await this.telegram.sendMessage(chatId, `Шукаю в архіві: "${query}"`, undefined, replyToMessageId);

    const result = await this.rag.ask(userId, query);

    const uniqueDates = [...new Set(
      result.sourceChunks.map(c => {
        const d = new Date(c.createdAt);
        return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
          + ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
      }),
    )];
    const sourcesText = uniqueDates.length > 0
      ? `\n\n📂 Джерела: ${uniqueDates.join(', ')}`
      : '';

    await this.telegram.sendMessage(chatId, `💬 ${result.answer}${sourcesText}`);
  }

  private async handleListTasks(chatId: number, userId: string, replyToMessageId: number): Promise<void> {
    const openTasks = await this.tasks.getOpenTasks(userId);
    if (openTasks.length === 0) {
      await this.telegram.sendMessage(chatId, '✅ Немає відкритих задач.', undefined, replyToMessageId);
      return;
    }
    const lines = openTasks.map((t, i) => `${i + 1}. ${t.text}`).join('\n');
    await this.telegram.sendMessage(chatId, `📋 Відкриті задачі:\n\n${lines}`, undefined, replyToMessageId);
  }

  private async handleMarkTaskDone(chatId: number, userId: string, taskHint: string, replyToMessageId: number): Promise<void> {
    const result = await this.tasks.markDone(userId, taskHint);
    if (!result) {
      await this.telegram.sendMessage(chatId, `❓ Не знайшов задачу схожу на: "${taskHint}"`, undefined, replyToMessageId);
      return;
    }
    await this.telegram.sendMessage(chatId, `✅ Позначив як виконану:\n~~${result.text}~~`, undefined, replyToMessageId);
  }

  private async handleRecording(
    chatId: number,
    userId: string,
    audioBuffer: Buffer,
    suggestedFileName: string,
    duration: number,
    preTranscribedText: string,
    detectedTemplate: string,
    messageId: number,
  ): Promise<void> {
    this.logger.log(`[user=${userId}] routing to ingest (detectedTemplate=${detectedTemplate})`);

    const result = await this.ingestAudio.execute({
      userId,
      channel: 'telegram',
      audioBuffer,
      suggestedFileName,
      knownDurationSeconds: duration,
      telegramChatId: String(chatId),
      telegramMessageId: messageId,
      preTranscribedText,
      detectedTemplate,
    });
    this.logger.log(`[user=${userId}] ingested → trackId=${result.trackId} status=${result.status}`);

    await this.telegram.sendMessage(
      chatId,
      `Прийняв запис 🎙️ Обробляю (track ${result.trackId}). Надішлю конспект сюди, як буде готово.`,
      undefined,
      messageId,
    );
  }
}
