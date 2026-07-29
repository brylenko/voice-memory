import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Minimal wrapper around the Telegram Bot HTTP API — just the three calls this
 * adapter needs. No bot framework dependency; easy to swap for `telegraf` later
 * without touching the controller's business logic.
 */
type TelegramResponse<T = unknown> = { ok: true; result: T } | { ok: false; description: string; error_code: number };

@Injectable()
export class TelegramApiClient {
  private readonly logger = new Logger(TelegramApiClient.name);
  private readonly botToken: string;

  constructor(private readonly config: ConfigService) {
    this.botToken = this.config.get<string>('telegram.botToken') ?? '';
  }

  private async post<T>(method: string, body: object): Promise<T> {
    const res = await fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json() as TelegramResponse<T>;
    if (!data.ok) {
      const msg = `Telegram ${method} failed [${data.error_code}]: ${data.description}`;
      this.logger.error(msg);
      throw new Error(msg);
    }
    return data.result;
  }

  private get apiBase(): string {
    return `https://api.telegram.org/bot${this.botToken}`;
  }

  async getFilePath(fileId: string): Promise<string> {
    const response = await fetch(`${this.apiBase}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const data = (await response.json()) as { ok: boolean; result?: { file_path: string } };
    if (!data.ok || !data.result) {
      throw new Error(`Telegram getFile failed: ${JSON.stringify(data)}`);
    }
    return data.result.file_path;
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const url = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Telegram file download failed: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    parseMode?: 'HTML',
    replyToMessageId?: number,
  ): Promise<{ message_id: number }> {
    return this.post<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      ...(replyToMessageId != null ? { reply_to_message_id: replyToMessageId } : {}),
    });
  }

  async sendMessageWithKeyboard(
    chatId: number | string,
    text: string,
    keyboard: Array<Array<{ text: string; callback_data: string }>>,
    parseMode?: 'HTML',
  ): Promise<{ message_id: number }> {
    return this.post<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  async editMessageReplyMarkup(
    chatId: number | string,
    messageId: number,
    keyboard: Array<Array<{ text: string; callback_data: string }>> | null,
  ): Promise<void> {
    await this.post('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard ?? [] },
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.post('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

}
