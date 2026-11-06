import { dayWindow } from './day-window';

describe('dayWindow', () => {
  it('maps a UTC+3 local day onto the right UTC window', () => {
    const w = dayWindow(180, '2026-11-05');
    expect(w.from.toISOString()).toBe('2026-11-04T21:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-11-05T21:00:00.000Z');
  });

  it('defaults to the *local* today, not the UTC one', () => {
    // 22:30 UTC on Nov 5 is already Nov 6 in UTC+3
    const w = dayWindow(180, undefined, new Date('2026-11-05T22:30:00Z'));
    expect(w.date).toBe('2026-11-06');
  });

  it('handles negative offsets', () => {
    const w = dayWindow(-300, '2026-01-10');
    expect(w.from.toISOString()).toBe('2026-01-10T05:00:00.000Z');
  });
});
