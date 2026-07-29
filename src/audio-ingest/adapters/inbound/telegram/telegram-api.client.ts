import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Minimal wrapper around the Telegram Bot HTTP API — just the three calls this
 * adapter needs. No bot framework dependency; easy to swap for `telegraf` later
 * without touching the controller's business logic.
 */
@Injectable()
export class TelegramApiClient {
  private readonly botToken: string;

  constructor(private readonly config: ConfigService) {
    this.botToken = this.config.get<string>('telegram.botToken') ?? '';
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
    parseMode?: 'MarkdownV2' | 'HTML',
    replyToMessageId?: number,
  ): Promise<void> {
    await fetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        ...(replyToMessageId != null ? { reply_to_message_id: replyToMessageId } : {}),
      }),
    });
  }

}
