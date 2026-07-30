import { CompleteUploadService } from './complete-upload.service';
import { TrackNotFoundError } from './errors';
import type { AudioTrackWriterPort } from './ports/outbound/audio-track-writer.port';
import type { AudioProcessingQueuePort } from './ports/outbound/audio-processing-queue.port';
import type { AudioTrackEntity } from '../../audio-track/audio-track.entity';

const TRACK_ID = 'track-uuid-002';
const STORAGE_KEY = 'uploads/user/voice.ogg';

function makeService(track: AudioTrackEntity | null) {
  const trackWriter: jest.Mocked<AudioTrackWriterPort> = {
    createInitialized: jest.fn(),
    findById: jest.fn().mockResolvedValue(track),
  };

  const queue: jest.Mocked<AudioProcessingQueuePort> = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  };

  const svc = new CompleteUploadService(trackWriter, queue);
  return { svc, trackWriter, queue };
}

const stubTrack = {
  id: TRACK_ID,
  userId: 'user-001',
  fileUrl: STORAGE_KEY,
  status: 'PENDING',
} as unknown as AudioTrackEntity;

describe('CompleteUploadService', () => {
  it('returns trackId and status on happy path', async () => {
    const { svc } = makeService(stubTrack);
    const result = await svc.execute({ trackId: TRACK_ID });
    expect(result).toEqual({ trackId: TRACK_ID, status: 'PENDING' });
  });

  it('enqueues job with correct storageKey from track.fileUrl', async () => {
    const { svc, queue } = makeService(stubTrack);
    await svc.execute({ trackId: TRACK_ID });
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      trackId: TRACK_ID,
      storageKey: STORAGE_KEY,
      userId: 'user-001',
    }));
  });

  it('throws TrackNotFoundError when track does not exist', async () => {
    const { svc } = makeService(null);
    await expect(svc.execute({ trackId: 'nonexistent' })).rejects.toBeInstanceOf(TrackNotFoundError);
  });

  it('does not enqueue when track is not found', async () => {
    const { svc, queue } = makeService(null);
    await expect(svc.execute({ trackId: 'missing' })).rejects.toThrow();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
