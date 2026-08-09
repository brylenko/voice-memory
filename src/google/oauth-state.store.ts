import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface StateEntry {
  userId: string;
  expiresAt: number;
}

/**
 * In-process store for OAuth CSRF state tokens.
 * Generates a cryptographically random, one-time-use token that maps to a userId.
 * TTL: 5 minutes — matches the maximum time a user would take to complete OAuth.
 *
 * Single-process assumption: this store lives in memory because the rest of the
 * app is also single-process (BackfillTasksCron uses an in-memory mutex). If the
 * app ever scales to multiple replicas, replace with a Redis-backed store.
 */
@Injectable()
export class OAuthStateStore {
  private readonly states = new Map<string, StateEntry>();

  generate(userId: string): string {
    this.evictExpired();
    const token = randomBytes(32).toString('hex');
    this.states.set(token, { userId, expiresAt: Date.now() + STATE_TTL_MS });
    return token;
  }

  /** Validates the token and consumes it (one-time use). Returns userId or null. */
  consume(token: string): string | null {
    const entry = this.states.get(token);
    this.states.delete(token); // consume regardless — prevents replay
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) return null;
    return entry.userId;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [token, entry] of this.states) {
      if (now > entry.expiresAt) this.states.delete(token);
    }
  }
}
