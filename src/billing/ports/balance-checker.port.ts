/**
 * Outbound port for the "does this user have enough minutes" question AND
 * the "they just used some minutes" event. Both live on the same port because
 * a real billing adapter almost always backs both with the same wallet row —
 * splitting them into two ports would just force two adapters to coordinate.
 */
export interface BalanceCheckerPort {
  getRemainingMinutes(userId: string): Promise<number>;

  /**
   * Called once processing actually completes, with the real (or best-known)
   * duration — this is what makes the balance check upstream meaningful
   * instead of decorative. A mock/no-op adapter is fine for a demo, but a
   * production binding MUST actually decrement a real balance here.
   */
  consumeMinutes(userId: string, minutes: number): Promise<void>;
}

export const BALANCE_CHECKER_PORT = Symbol('BALANCE_CHECKER_PORT');
