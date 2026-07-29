import { Injectable, Logger } from '@nestjs/common';

/**
 * Push-notification stub. By the time a summary is ready, the physical device
 * itself is typically asleep, so the result is pushed to the companion mobile
 * app instead. Swap this implementation for FCM/APNs without touching callers.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  async sendPushNotification(userId: string, trackId: string, title: string): Promise<void> {
    // TODO: integrate FCM / APNs SDK here.
    this.logger.log(`[push -> user:${userId}] "${title}" (track ${trackId}) is ready`);
  }
}
