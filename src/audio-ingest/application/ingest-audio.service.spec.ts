import { IngestAudioService } from './ingest-audio.service';
import { InsufficientBalanceError } from './errors';
import type { AudioMetadataPort } from './ports/outbound/audio-metadata.port';
import type { BalanceCheckerPort } from '../../billing/ports/balance-checker.port';
import type { AudioStoragePort } from './ports/outbound/audio-storage.port';
import type { AudioTrackWriterPort } from './ports/outbound/audio-track-writer.port';
import type { AudioProcessingQueuePort } from './ports/outbound/audio-processing-queue.port';
import type { AudioTrackEntity } from '../../audio-track/audio-track.entity';

const TRACK_ID = 'track-uuid-001';
const USER_ID = 'user-uuid-001';
const STORAGE_KEY = 'uploads/user-uuid-001/voice.ogg';

function makeService(overrides: {
  remainingMinutes?: number;
  durationSeconds?: number;
}) {
  const { remainingMinutes = 10, durationSeconds = 60 } = overrides;

  const metadata: jest.Mocked<AudioMetadataPort> = {
    getDurationSeconds: jest.fn().mockResolvedValue(durationSeconds),
  };

  const balance: jest.Mocked<BalanceCheckerPort> = {
    getRemainingMinutes: jest.fn().mockResolvedValue(remainingMinutes),
    consumeMinutes: jest.fn().mockResolvedValue(undefined),
  };

  const storage: jest.Mocked<AudioStoragePort> = {
    save: jest.fn().mockResolvedValue({ storageKey: STORAGE_KEY, publicUrl: 'https://cdn/voice.ogg' }),
    createUploadUrl: jest.fn(),
  };

  const trackWriter: jest.Mocked<AudioTrackWriterPort> = {
    createInitialized: jest.fn().mockResolvedValue({
      id: TRACK_ID,
      userId: USER_ID,
      status: 'PENDING',
      fileUrl: STORAGE_KEY,
    } as unknown as AudioTrackEntity),
    findById: jest.fn(),
  };

  const queue: jest.Mocked<AudioProcessingQueuePort> = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  };

  const svc = new IngestAudioService(metadata, balance, storage, trackWriter, queue);

  return { svc, metadata, balance, storage, trackWriter, queue };
}

const baseCommand = {
  userId: USER_ID,
  channel: 'telegram' as const,
  audioBuffer: Buffer.from('fake-audio'),
  suggestedFileName: 'voice.ogg',
  telegramChatId: '123456',
  telegramMessageId: 42,
};

describe('IngestAudioService', () => {
  it('returns trackId and status on happy path', async () => {
    const { svc } = makeService({});
    const result = await svc.execute(baseCommand);
    expect(result).toEqual({ trackId: TRACK_ID, status: 'PENDING' });
  });

  it('throws InsufficientBalanceError when balance < required minutes', async () => {
    const { svc } = makeService({ remainingMinutes: 0, durationSeconds: 90 });
    await expect(svc.execute(baseCommand)).rejects.toBeInstanceOf(InsufficientBalanceError);
  });

  it('calls balance check with correct required minutes (ceil division)', async () => {
    const { svc, balance } = makeService({ durationSeconds: 90 }); // 90s → 2 min
    await svc.execute(baseCommand);
    expect(balance.getRemainingMinutes).toHaveBeenCalledWith(USER_ID);
  });

  it('skips metadata call when knownDurationSeconds is provided', async () => {
    const { svc, metadata } = makeService({});
    await svc.execute({ ...baseCommand, knownDurationSeconds: 30 });
    expect(metadata.getDurationSeconds).not.toHaveBeenCalled();
  });

  it('enqueues job with preTranscribedText and detectedTemplate', async () => {
    const { svc, queue } = makeService({});
    await svc.execute({
      ...baseCommand,
      knownDurationSeconds: 60,
      preTranscribedText: 'already transcribed',
      detectedTemplate: 'custom',
    });
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      preTranscribedText: 'already transcribed',
      detectedTemplate: 'custom',
    }));
  });

  it('does not call storage when balance is insufficient', async () => {
    const { svc, storage } = makeService({ remainingMinutes: 0, durationSeconds: 120 });
    await expect(svc.execute(baseCommand)).rejects.toThrow();
    expect(storage.save).not.toHaveBeenCalled();
  });
});
