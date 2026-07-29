import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/**
 * Validates that an upload actually comes from a provisioned physical device.
 * This guard is specific to the HTTP/device inbound adapter — the Telegram
 * inbound adapter has its own, differently-shaped guard (webhook secret token),
 * and both ultimately call the same IngestAudioUseCase.
 *
 * Expected headers:
 *   X-Device-Serial:    the device's serial number
 *   X-Device-Timestamp: unix seconds when the device signed the request
 *   X-Device-Signature: hex HMAC-SHA256( `${serial}.${timestamp}`, secret )
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const serial = request.header('X-Device-Serial');
    const timestampHeader = request.header('X-Device-Timestamp');
    const signature = request.header('X-Device-Signature');

    if (!serial || !timestampHeader || !signature) {
      throw new UnauthorizedException('Missing device authentication headers');
    }

    const timestamp = parseInt(timestampHeader, 10);
    if (!Number.isFinite(timestamp)) {
      throw new UnauthorizedException('Invalid device timestamp');
    }

    const ttlSeconds = this.config.get<number>('device.signatureTtlSeconds') ?? 300;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > ttlSeconds) {
      throw new UnauthorizedException('Device signature expired');
    }

    const secret = this.config.get<string>('device.hmacSecret') ?? '';
    const expected = createHmac('sha256', secret)
      .update(`${serial}.${timestamp}`)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(signature, 'hex');

    const isValid =
      expectedBuf.length === providedBuf.length &&
      timingSafeEqual(expectedBuf, providedBuf);

    if (!isValid) {
      throw new UnauthorizedException('Invalid device signature');
    }

    (request as Request & { deviceSerial?: string }).deviceSerial = serial;
    return true;
  }
}
