import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './user.entity';

export interface DeviceUser {
  id: string;
  /** True when payment is required and the free-track quota is used up. */
  blocked: boolean;
}

/**
 * Maps an authenticated device serial onto a user row (creating it on first
 * contact) and evaluates the free-quota gate. Shared by every live WebSocket
 * channel so the rules live in exactly one place.
 */
@Injectable()
export class DeviceUserResolver {
  private readonly logger = new Logger(DeviceUserResolver.name);

  constructor(
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    private readonly config: ConfigService,
  ) {}

  async resolve(deviceId: string): Promise<DeviceUser> {
    // Atomic upsert prevents UNIQUE violation under concurrent connections from the same device.
    const rows: Array<{ id: string }> = await this.userRepo.manager.query(
      `INSERT INTO users ("deviceId") VALUES ($1)
       ON CONFLICT ("deviceId") DO NOTHING
       RETURNING id`,
      [deviceId],
    );

    let user: { id: string; freeTracksUsed: number };
    if (rows.length > 0) {
      this.logger.log(`Created new user for deviceId=***${deviceId.slice(-4)}: ${rows[0].id}`);
      user = { id: rows[0].id, freeTracksUsed: 0 };
    } else {
      user = await this.userRepo.findOneByOrFail({ deviceId });
    }

    const limit = this.config.get<number>('payment.freeTracksLimit') ?? 10;
    const quotaExceeded = limit > 0 && user.freeTracksUsed >= limit;
    const blocked = quotaExceeded && this.config.get<boolean>('payment.required') === true;
    return { id: user.id, blocked };
  }

  get paymentUrl(): string | undefined {
    return this.config.get<string>('payment.url');
  }
}
