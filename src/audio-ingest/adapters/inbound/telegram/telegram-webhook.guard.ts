import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/**
 * Telegram signs webhook calls by echoing back a secret token you chose when
 * calling `setWebhook` (`secret_token` param), sent as the
 * `X-Telegram-Bot-Api-Secret-Token` header. This is the Telegram-channel
 * equivalent of DeviceAuthGuard — same purpose (only let the real sender in),
 * different mechanism, because the transport is different.
 */
@Injectable()
export class TelegramWebhookGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('X-Telegram-Bot-Api-Secret-Token') ?? '';
    const expected = this.config.get<string>('telegram.webhookSecret') ?? '';

    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);

    const isValid =
      expectedBuf.length > 0 &&
      providedBuf.length === expectedBuf.length &&
      timingSafeEqual(providedBuf, expectedBuf);

    if (!isValid) {
      throw new UnauthorizedException('Invalid Telegram webhook secret token');
    }
    return true;
  }
}
