import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import {
  AudioStoragePort,
  PresignedUpload,
  SaveAudioInput,
  StoredAudioFile,
} from '../../../application/ports/outbound/audio-storage.port';

/** Local-disk implementation. Swap for an S3AudioStorageAdapter in production
 * without touching IngestAudioService or any inbound adapter. */
@Injectable()
export class LocalDiskStorageAdapter implements AudioStoragePort {
  constructor(private readonly config: ConfigService) {}

  async save(input: SaveAudioInput): Promise<StoredAudioFile> {
    const uploadDir = this.config.get<string>('uploadDir') ?? './uploads';
    const userDir = join(uploadDir, input.userId);
    await mkdir(userDir, { recursive: true });

    const ext = extname(input.suggestedName) || '.bin';
    const fileName = `${randomUUID()}${ext}`;
    const fullPath = join(userDir, fileName);

    await writeFile(fullPath, input.buffer);

    const publicBaseUrl = this.config.get<string>('publicBaseUrl');
    return {
      storageKey: fullPath,
      publicUrl: `${publicBaseUrl}/uploads/${input.userId}/${fileName}`,
    };
  }

  /**
   * There's no real "direct to disk from the client" for local dev — so this
   * points at a tiny raw-body PUT endpoint on our own server
   * (LocalUploadController) that just streams the body straight to disk.
   * It exists purely so the two-phase upload-url/upload-complete flow can be
   * exercised without AWS credentials; it gets none of S3's "bypass our
   * server" benefit, which is expected — that benefit only matters in prod
   * where STORAGE_DRIVER=s3 anyway.
   */
  async createUploadUrl(suggestedName: string, userId: string): Promise<PresignedUpload> {
    const uploadDir = this.config.get<string>('uploadDir') ?? './uploads';
    const userDir = join(uploadDir, userId);
    await mkdir(userDir, { recursive: true });

    const ext = extname(suggestedName) || '.bin';
    const fileName = `${randomUUID()}${ext}`;
    const fullPath = join(userDir, fileName);

    const publicBaseUrl = this.config.get<string>('publicBaseUrl');
    return {
      storageKey: fullPath,
      uploadUrl: `${publicBaseUrl}/audio/local-upload/${userId}/${fileName}`,
      publicUrl: `${publicBaseUrl}/uploads/${userId}/${fileName}`,
      expiresInSeconds: 900,
    };
  }
}
