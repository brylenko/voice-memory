/**
 * Unit tests for BackfillTasksCron.reconcileAbandonedUploads() (C2 fix).
 *
 * Tests call the private method directly to avoid the complexity of
 * mocking the full cron lifecycle. The method's logic is:
 *   - query INITIALIZED tracks older than threshold
 *   - for each: call storage.exists()
 *   - missing → conditional UPDATE to FAILED (WHERE status = INITIALIZED)
 *   - exists  → leave unchanged
 *   - storage throws → log and skip (do not mark FAILED)
 */
import { BackfillTasksCron } from './backfill-tasks.cron';
import { AudioTrackStatus } from '../audio-track/audio-track.entity';
import { ConfigService } from '@nestjs/config';

const THRESHOLD_MINUTES = 30;

function makeTrack(id: string, fileUrl = `recordings/${id}.ogg`) {
  return { id, fileUrl, status: AudioTrackStatus.INITIALIZED } as any;
}

function makeCron(opts: {
  candidates?: any[];
  storageExists?: boolean | Error;
  dbQueryResult?: unknown;
}) {
  const candidates = opts.candidates ?? [];
  const dbQuery = jest.fn().mockResolvedValue(opts.dbQueryResult ?? [null, 1]);

  const qbMock = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(candidates),
  };

  const repo = {
    createQueryBuilder: jest.fn().mockReturnValue(qbMock),
    manager: { query: dbQuery },
  } as any;

  const storage = {
    exists: jest.fn().mockImplementation(() => {
      if (opts.storageExists instanceof Error) return Promise.reject(opts.storageExists);
      return Promise.resolve(opts.storageExists ?? true);
    }),
    save: jest.fn(),
    createUploadUrl: jest.fn(),
  };

  const config = {
    get: jest.fn((key: string) => key === 'staleUploadThresholdMinutes' ? THRESHOLD_MINUTES : undefined),
  } as unknown as ConfigService;

  const cron = new BackfillTasksCron(
    repo,
    { complete: jest.fn() } as any,
    { summarize: jest.fn() } as any,
    { decryptTrack: jest.fn((t: any) => t), encryptJson: jest.fn() } as any,
    { enqueue: jest.fn().mockResolvedValue(undefined) } as any,
    storage as any,
    config,
  );

  return { cron, repo, storage, dbQuery };
}

describe('BackfillTasksCron — C2 reconcileAbandonedUploads', () => {
  it('marks track FAILED when S3 object is missing', async () => {
    const track = makeTrack('track-1');
    const { cron, storage, dbQuery } = makeCron({
      candidates: [track],
      storageExists: false,
    });

    await (cron as any).reconcileAbandonedUploads();

    expect(storage.exists).toHaveBeenCalledWith(track.fileUrl);
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE audio_tracks SET status'),
      [AudioTrackStatus.FAILED, track.id, AudioTrackStatus.INITIALIZED],
    );
  });

  it('leaves track INITIALIZED when S3 object exists', async () => {
    const track = makeTrack('track-2');
    const { cron, storage, dbQuery } = makeCron({
      candidates: [track],
      storageExists: true,
    });

    await (cron as any).reconcileAbandonedUploads();

    expect(storage.exists).toHaveBeenCalledWith(track.fileUrl);
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('does not check S3 when query returns no candidates', async () => {
    const { cron, storage } = makeCron({ candidates: [] });

    await (cron as any).reconcileAbandonedUploads();

    expect(storage.exists).not.toHaveBeenCalled();
  });

  it('does not mark FAILED on transient S3 error — resolves without throwing', async () => {
    const track = makeTrack('track-3');
    const { cron, storage, dbQuery } = makeCron({
      candidates: [track],
      storageExists: new Error('connection timeout'),
    });

    await expect((cron as any).reconcileAbandonedUploads()).resolves.toBeUndefined();

    expect(storage.exists).toHaveBeenCalled();
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('handles race: UPDATE WHERE status=INITIALIZED returns 0 rows, no error thrown', async () => {
    const track = makeTrack('track-4');
    const { cron, dbQuery } = makeCron({
      candidates: [track],
      storageExists: false,
      dbQueryResult: [null, 0], // concurrent status change → 0 affected rows
    });

    await expect((cron as any).reconcileAbandonedUploads()).resolves.toBeUndefined();

    // UPDATE must still be attempted with the conditional WHERE clause
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE audio_tracks SET status'),
      [AudioTrackStatus.FAILED, track.id, AudioTrackStatus.INITIALIZED],
    );
  });
});
