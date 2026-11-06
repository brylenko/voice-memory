import { AudioTrackStatus } from '../audio-track/audio-track.entity';
import { LiveTrackService } from './live-track.service';

describe('LiveTrackService.finalize', () => {
  it('closes an empty session without any AI call and marks tags as processed', async () => {
    const trackRepo = { update: jest.fn().mockResolvedValue(undefined), findOneByOrFail: jest.fn() };
    const summarization = { summarize: jest.fn() };
    const embedding = { embed: jest.fn() };
    const svc = new LiveTrackService(
      embedding as never, summarization as never, trackRepo as never, {} as never, {} as never,
    );

    await svc.finalize('t1', 'u1', '   ');

    expect(trackRepo.update).toHaveBeenCalledWith('t1', { status: AudioTrackStatus.COMPLETED, tagsProcessed: true });
    expect(summarization.summarize).not.toHaveBeenCalled();
    expect(embedding.embed).not.toHaveBeenCalled();
  });
});
