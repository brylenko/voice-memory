import { LocalDiskStorageAdapter } from './local-disk-storage.adapter';
import { access } from 'fs/promises';
import { ConfigService } from '@nestjs/config';

jest.mock('fs/promises', () => ({
  ...jest.requireActual('fs/promises'),
  access: jest.fn(),
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

const accessMock = access as jest.MockedFunction<typeof access>;

function makeAdapter() {
  const config = { get: jest.fn().mockReturnValue('./uploads') } as unknown as ConfigService;
  return new LocalDiskStorageAdapter(config);
}

describe('LocalDiskStorageAdapter.exists()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns true when file exists', async () => {
    accessMock.mockResolvedValueOnce(undefined);
    const adapter = makeAdapter();
    await expect(adapter.exists('/uploads/user/file.ogg')).resolves.toBe(true);
  });

  it('returns false when file does not exist (ENOENT)', async () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
    accessMock.mockRejectedValueOnce(err);
    const adapter = makeAdapter();
    await expect(adapter.exists('/uploads/user/missing.ogg')).resolves.toBe(false);
  });

  it('throws on permission error (EACCES) — does not swallow infrastructure errors', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    accessMock.mockRejectedValueOnce(err);
    const adapter = makeAdapter();
    await expect(adapter.exists('/uploads/user/file.ogg')).rejects.toThrow('permission denied');
  });
});
