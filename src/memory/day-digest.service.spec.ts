import { AudioTrackStatus } from '../audio-track/audio-track.entity';
import { DayDigestService } from './day-digest.service';

const at = (iso: string) => new Date(iso);

function makeService(rows: unknown[]) {
  const tracks = { find: jest.fn().mockResolvedValue(rows) };
  const chat = { complete: jest.fn().mockResolvedValue('• recap') };
  const encryption = { decryptTrack: (t: unknown) => t };
  const svc = new DayDigestService(tracks as never, chat as never, encryption as never);
  return { svc, chat, tracks };
}

const done = {
  id: 't1', createdAt: at('2026-11-05T09:00:00Z'), status: AudioTrackStatus.COMPLETED,
  duration: 60, channel: 'wear-os', tags: ['demo'],
  summaries: { executive: 'Agreed to move the demo to Tuesday' }, fullText: 'long text',
};
const live = {
  id: 't2', createdAt: at('2026-11-05T10:00:00Z'), status: AudioTrackStatus.PROCESSING,
  duration: 0, channel: 'wear-live', tags: [], summaries: null,
  fullText: 'x'.repeat(500) + ' and the budget is 40k',
};

describe('DayDigestService', () => {
  it('returns the live conversation (latest words) next to completed ones', async () => {
    const { svc } = makeService([done, live]);
    const day = await svc.getDay('u1', { date: '2026-11-05', tzOffsetMinutes: 0 });

    expect(day.items.map((i) => [i.trackId, i.live])).toEqual([['t1', false], ['t2', true]]);
    expect(day.items[1].summary.startsWith('…')).toBe(true);
    expect(day.items[1].summary.endsWith('the budget is 40k')).toBe(true);
  });

  it('builds the recap only from completed recordings and caches it across polls', async () => {
    const { svc, chat } = makeService([done, live]);
    await svc.getDay('u1', { date: '2026-11-05' });
    const second = await svc.getDay('u1', { date: '2026-11-05' });

    expect(chat.complete).toHaveBeenCalledTimes(1);
    expect(chat.complete.mock.calls[0][0][1].content).not.toContain('budget');
    expect(second.digest).toBe('• recap');
  });

  it('skips the LLM when only a live conversation exists', async () => {
    const { svc, chat } = makeService([live]);
    const day = await svc.getDay('u1', { date: '2026-11-05' });
    expect(day.digest).toBeNull();
    expect(chat.complete).not.toHaveBeenCalled();
  });
});
