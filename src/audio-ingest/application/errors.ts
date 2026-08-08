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

export class TrackOwnershipError extends Error {
  constructor(public readonly trackId: string) {
    super(`Track ${trackId} does not belong to the requesting user`);
    this.name = 'TrackOwnershipError';
  }
}

export class TrackAlreadyProcessingError extends Error {
  constructor(
    public readonly trackId: string,
    public readonly currentStatus: string,
  ) {
    super(`Track ${trackId} is already ${currentStatus} — duplicate complete-upload ignored`);
    this.name = 'TrackAlreadyProcessingError';
  }
}
