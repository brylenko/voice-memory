import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { S3_CLIENT } from '../../../../common/services/s3-client.provider';
import {
  AudioStoragePort,
  PresignedUpload,
  SaveAudioInput,
  StoredAudioFile,
} from '../../../application/ports/outbound/audio-storage.port';

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
};

/**
 * S3 implementation of AudioStoragePort. Bind STORAGE_DRIVER=s3 to use this
 * instead of LocalDiskStorageAdapter — nothing in IngestAudioService or any
 * inbound adapter (HTTP device, Telegram) needs to change.
 *
 * `storageKey` returned here is the S3 object key (e.g. "recordings/<uuid>.ogg"),
 * NOT a local path — S3RetrievalAdapter on the worker side knows how to turn
 * that key back into bytes (see src/queue/adapters).
 */
@Injectable()
export class S3AudioStorageAdapter implements AudioStoragePort {
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly config: ConfigService,
  ) {}

  async save(input: SaveAudioInput): Promise<StoredAudioFile> {
    const bucket = this.config.get<string>('s3.bucket');
    if (!bucket) {
      throw new InternalServerErrorException('S3_BUCKET_NAME is not configured');
    }

    const ext = extname(input.suggestedName).toLowerCase() || '.bin';
    const key = `recordings/${input.userId}/${randomUUID()}${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: input.buffer,
        ContentType: CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream',
      }),
    );

    const expiresIn = this.config.get<number>('s3.presignedUrlTtlSeconds') ?? 86400;
    const publicUrl = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn },
    );

    return { storageKey: key, publicUrl };
  }

  /**
   * Client (device) PUTs bytes straight to S3 with this URL — our server never
   * touches the audio bytes at all, so 100 concurrent uploads cost us nothing
   * in memory/CPU/egress. We still generate the key server-side so we control
   * the namespace (`recordings/...`) and know it up front for the DB row.
   */
  async createUploadUrl(suggestedName: string, userId: string): Promise<PresignedUpload> {
    const bucket = this.config.get<string>('s3.bucket');
    if (!bucket) {
      throw new InternalServerErrorException('S3_BUCKET_NAME is not configured');
    }

    const ext = extname(suggestedName).toLowerCase() || '.bin';
    const key = `recordings/${userId}/${randomUUID()}${ext}`;
    const contentType = CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';

    const uploadExpiresIn = this.config.get<number>('s3.presignedUploadUrlTtlSeconds') ?? 900;
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: uploadExpiresIn },
    );

    const downloadExpiresIn = this.config.get<number>('s3.presignedUrlTtlSeconds') ?? 86400;
    const publicUrl = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: downloadExpiresIn },
    );

    return { storageKey: key, uploadUrl, publicUrl, expiresInSeconds: uploadExpiresIn };
  }
}
