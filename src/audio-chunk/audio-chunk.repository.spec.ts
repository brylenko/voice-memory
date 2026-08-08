import { AudioChunkRepository, InsertChunkInput } from './audio-chunk.repository';
import { DataSource } from 'typeorm';
import { DayOfWeek } from './audio-chunk.entity';

function makeChunk(trackId: string, text: string): InsertChunkInput {
  return {
    trackId,
    userId: 'user-001',
    text,
    embedding: [0.1, 0.2, 0.3],
    dayOfWeek: DayOfWeek.Monday,
    createdAt: new Date('2026-01-01'),
  };
}

function makeRepo(queryMock: jest.Mock) {
  const manager = { query: queryMock };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: typeof manager) => Promise<void>) => cb(manager)),
  } as unknown as DataSource;
  return new AudioChunkRepository(dataSource);
}

describe('AudioChunkRepository.replaceChunks', () => {
  it('acquires advisory lock, deletes, then inserts chunks', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repo = makeRepo(query);

    await repo.replaceChunks('track-1', [makeChunk('track-1', 'hello')]);

    const calls = query.mock.calls.map((c) => (c[0] as string).trim());
    expect(calls[0]).toMatch(/pg_advisory_xact_lock/);
    expect(calls[1]).toMatch(/DELETE FROM audio_chunks/);
    expect(calls[2]).toMatch(/INSERT INTO audio_chunks/);
  });

  it('deletes stale chunks even when new chunks list is empty', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repo = makeRepo(query);

    await repo.replaceChunks('track-empty', []);

    const calls = query.mock.calls.map((c) => (c[0] as string).trim());
    expect(calls[0]).toMatch(/pg_advisory_xact_lock/);
    expect(calls[1]).toMatch(/DELETE FROM audio_chunks/);
    // No INSERT call
    expect(calls.length).toBe(2);
  });

  it('passes correct trackId to DELETE', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repo = makeRepo(query);

    await repo.replaceChunks('track-xyz', []);

    const deleteCall = query.mock.calls.find((c) => (c[0] as string).includes('DELETE'));
    expect(deleteCall?.[1]).toEqual(['track-xyz']);
  });

  it('inserts all chunks when multiple provided', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repo = makeRepo(query);

    await repo.replaceChunks('track-1', [
      makeChunk('track-1', 'chunk A'),
      makeChunk('track-1', 'chunk B'),
      makeChunk('track-1', 'chunk C'),
    ]);

    const inserts = query.mock.calls.filter((c) => (c[0] as string).includes('INSERT'));
    expect(inserts.length).toBe(3);
  });

  it('advisory lock uses trackId as key', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repo = makeRepo(query);

    await repo.replaceChunks('track-lock-test', []);

    const lockCall = query.mock.calls.find((c) => (c[0] as string).includes('pg_advisory_xact_lock'));
    expect(lockCall?.[1]).toEqual(['track-lock-test']);
  });
});
