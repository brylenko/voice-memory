import { BullMqAudioQueueAdapter } from './bullmq-audio-queue.adapter';
import type { Queue } from 'bull';

function makeAdapter() {
  const queue = { add: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<Queue>;
  const adapter = new BullMqAudioQueueAdapter(queue as Queue);
  return { adapter, queue };
}

describe('BullMqAudioQueueAdapter', () => {
  it('uses trackId as jobId for idempotent enqueue', async () => {
    const { adapter, queue } = makeAdapter();
    await adapter.enqueue({ trackId: 'track-001', storageKey: 'key/file.ogg', userId: 'user-001' });
    expect(queue.add).toHaveBeenCalledWith(
      'process-audio-track',
      expect.objectContaining({ trackId: 'track-001' }),
      expect.objectContaining({ jobId: 'track-001' }),
    );
  });

  it('passes all job data fields', async () => {
    const { adapter, queue } = makeAdapter();
    await adapter.enqueue({
      trackId: 'track-002',
      storageKey: 'key/file.ogg',
      userId: 'user-002',
      preTranscribedText: 'hello',
      detectedTemplate: 'meeting',
    });
    expect(queue.add).toHaveBeenCalledWith(
      'process-audio-track',
      expect.objectContaining({
        trackId: 'track-002',
        storageKey: 'key/file.ogg',
        userId: 'user-002',
        preTranscribedText: 'hello',
        detectedTemplate: 'meeting',
      }),
      expect.anything(),
    );
  });

  it('configures retry attempts and backoff', async () => {
    const { adapter, queue } = makeAdapter();
    await adapter.enqueue({ trackId: 'track-003', storageKey: 'key/file.ogg', userId: 'user-003' });
    expect(queue.add).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        attempts: 5,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnFail: false,
      }),
    );
  });
});
