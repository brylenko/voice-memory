import { Injectable, Logger } from '@nestjs/common';
import { BalanceCheckerPort } from '../ports/balance-checker.port';

/**
 * Mock. Always reports a generous balance and only logs consumption instead
 * of persisting it — fine for a demo, NOT fine for production. Replace with
 * an adapter backed by a real `wallets`/`subscriptions` table and a payment
 * provider webhook (Stripe etc.) before launch; see README "Path to production".
 */
@Injectable()
export class MockBalanceCheckerAdapter implements BalanceCheckerPort {
  private readonly logger = new Logger(MockBalanceCheckerAdapter.name);

  async getRemainingMinutes(userId: string): Promise<number> {
    void userId;
    return 999;
  }

  async consumeMinutes(userId: string, minutes: number): Promise<void> {
    // A real adapter does `UPDATE wallets SET remaining_minutes = remaining_minutes - $1 WHERE user_id = $2`
    // (in a transaction, with a check constraint / row lock against going negative).
    this.logger.warn(`[MOCK] would consume ${minutes}m for user ${userId} — balance not actually persisted`);
  }
}
