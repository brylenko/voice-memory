import { CompleteUploadService } from './complete-upload.service';
import { TrackAlreadyProcessingError, TrackNotFoundError, TrackOwnershipError } from './errors';
import type { AudioTrackWriterPort } from './ports/outbound/audio-track-writer.port';
import type { AudioProcessingQueuePort } from './ports/outbound/audio-processing-queue.port';
import { AudioTrackEntity, AudioTrackStatus } from '../../audio-track/audio-track.entity';

const TRACK_ID = 'track-uuid-002';
const USER_ID = 'user-001';
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

function makeTrack(overrides: Partial<AudioTrackEntity> = {}): AudioTrackEntity {
  return {
    id: TRACK_ID,
    userId: USER_ID,
    fileUrl: STORAGE_KEY,
    status: AudioTrackStatus.INITIALIZED,
    ...overrides,
  } as AudioTrackEntity;
}

describe('CompleteUploadService', () => {
  it('returns trackId and status on happy path', async () => {
    const { svc } = makeService(makeTrack());
    const result = await svc.execute({ trackId: TRACK_ID, userId: USER_ID });
    expect(result).toEqual({ trackId: TRACK_ID, status: AudioTrackStatus.INITIALIZED });
  });

  it('enqueues job with correct storageKey from track.fileUrl', async () => {
    const { svc, queue } = makeService(makeTrack());
    await svc.execute({ trackId: TRACK_ID, userId: USER_ID });
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      trackId: TRACK_ID,
      storageKey: STORAGE_KEY,
      userId: USER_ID,
    }));
  });

  it('throws TrackNotFoundError when track does not exist', async () => {
    const { svc } = makeService(null);
    await expect(svc.execute({ trackId: 'nonexistent', userId: USER_ID })).rejects.toBeInstanceOf(TrackNotFoundError);
  });

  it('does not enqueue when track is not found', async () => {
    const { svc, queue } = makeService(null);
    await expect(svc.execute({ trackId: 'missing', userId: USER_ID })).rejects.toThrow();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('throws TrackOwnershipError when userId does not match track owner', async () => {
    const { svc } = makeService(makeTrack({ userId: 'other-user' }));
    await expect(svc.execute({ trackId: TRACK_ID, userId: USER_ID })).rejects.toBeInstanceOf(TrackOwnershipError);
  });

  it('does not enqueue when userId does not match', async () => {
    const { svc, queue } = makeService(makeTrack({ userId: 'other-user' }));
    await expect(svc.execute({ trackId: TRACK_ID, userId: USER_ID })).rejects.toThrow();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('throws TrackAlreadyProcessingError when track is already PROCESSING', async () => {
    const { svc } = makeService(makeTrack({ status: AudioTrackStatus.PROCESSING }));
    await expect(svc.execute({ trackId: TRACK_ID, userId: USER_ID })).rejects.toBeInstanceOf(TrackAlreadyProcessingError);
  });

  it('throws TrackAlreadyProcessingError when track is COMPLETED', async () => {
    const { svc } = makeService(makeTrack({ status: AudioTrackStatus.COMPLETED }));
    await expect(svc.execute({ trackId: TRACK_ID, userId: USER_ID })).rejects.toBeInstanceOf(TrackAlreadyProcessingError);
  });

  it('does not enqueue when track is already processing', async () => {
    const { svc, queue } = makeService(makeTrack({ status: AudioTrackStatus.PROCESSING }));
    await expect(svc.execute({ trackId: TRACK_ID, userId: USER_ID })).rejects.toThrow();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
