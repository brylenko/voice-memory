import { Injectable } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { AudioRetrievalPort } from '../ports/audio-retrieval.port';

/** Counterpart to LocalDiskStorageAdapter: storageKey is a local filesystem path. */
@Injectable()
export class LocalDiskRetrievalAdapter implements AudioRetrievalPort {
  async getBuffer(storageKey: string): Promise<Buffer> {
    return readFile(storageKey);
  }
}
