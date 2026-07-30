import { EncryptionService } from './encryption.service';
import { ConfigService } from '@nestjs/config';

const VALID_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

function makeService(key: string | undefined): EncryptionService {
  const config = { get: (_: string) => key } as unknown as ConfigService;
  const svc = new EncryptionService(config);
  svc.onModuleInit();
  return svc;
}

describe('EncryptionService', () => {
  describe('when encryption key is set', () => {
    let svc: EncryptionService;

    beforeEach(() => {
      svc = makeService(VALID_KEY);
    });

    it('encrypt → decrypt roundtrip returns original string', () => {
      const plain = 'hello world 🎙️';
      expect(svc.decrypt(svc.encrypt(plain))).toBe(plain);
    });

    it('produces different ciphertext each call (random IV)', () => {
      const plain = 'same input';
      expect(svc.encrypt(plain)).not.toBe(svc.encrypt(plain));
    });

    it('encryptJson → decryptJson roundtrip preserves object shape', () => {
      const obj = { tasks: [{ id: '1', text: 'buy milk', done: false }], eventDate: null };
      expect(svc.decryptJson(svc.encryptJson(obj))).toEqual(obj);
    });

    it('decrypt returns value as-is when it looks like plain text (legacy row)', () => {
      expect(svc.decrypt('plain unencrypted string')).toBe('plain unencrypted string');
    });

    it('decryptTrack decrypts fullText and summaries in-place', () => {
      const summaries = { executive: 'meeting notes', tasks: [] };
      const track = {
        fullText: svc.encrypt('full transcript'),
        summaries: svc.encryptJson(summaries),
      };
      svc.decryptTrack(track);
      expect(track.fullText).toBe('full transcript');
      expect(track.summaries).toEqual(summaries);
    });

    it('decryptTrack is safe when fullText is null', () => {
      const track = { fullText: null, summaries: null };
      expect(() => svc.decryptTrack(track)).not.toThrow();
    });
  });

  describe('when encryption key is not set', () => {
    let svc: EncryptionService;

    beforeEach(() => {
      svc = makeService(undefined);
    });

    it('encrypt returns plaintext unchanged', () => {
      expect(svc.encrypt('hello')).toBe('hello');
    });

    it('decrypt returns value unchanged', () => {
      expect(svc.decrypt('anything')).toBe('anything');
    });
  });

  describe('invalid key', () => {
    it('throws on module init when key is wrong length', () => {
      const config = { get: () => 'tooshort' } as unknown as ConfigService;
      const svc = new EncryptionService(config);
      expect(() => svc.onModuleInit()).toThrow('ENCRYPTION_KEY must be 64 hex characters');
    });
  });
});
