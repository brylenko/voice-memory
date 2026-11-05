export interface DayWindow {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  from: Date;
  to: Date;
}

/**
 * Converts a local calendar day into a UTC [from, to) window.
 * `tzOffsetMinutes` follows the ISO convention: minutes *east* of UTC
 * (Kyiv summer time = +180), i.e. what `ZoneOffset.totalSeconds / 60` gives on Android.
 */
export function dayWindow(tzOffsetMinutes: number, date?: string, now: Date = new Date()): DayWindow {
  const localNow = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  const day = date ?? localNow.toISOString().slice(0, 10);
  const localMidnightAsUtc = Date.parse(`${day}T00:00:00Z`);
  const from = new Date(localMidnightAsUtc - tzOffsetMinutes * 60_000);
  const to = new Date(from.getTime() + 86_400_000);
  return { date: day, from, to };
}
