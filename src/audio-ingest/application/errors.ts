/**
 * Framework-agnostic domain error. Each inbound adapter maps it to whatever
 * makes sense on its side (HTTP 403 for the device API, a chat reply for Telegram).
 */
export class InsufficientBalanceError extends Error {
  constructor(
    public readonly requiredMinutes: number,
    public readonly remainingMinutes: number,
  ) {
    super(`Insufficient balance: need ${requiredMinutes}m, have ${remainingMinutes}m`);
    this.name = 'InsufficientBalanceError';
  }
}

export class TrackNotFoundError extends Error {
  constructor(public readonly trackId: string) {
    super(`Audio track not found: ${trackId}`);
    this.name = 'TrackNotFoundError';
  }
}
