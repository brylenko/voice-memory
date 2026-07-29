import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3_CLIENT } from '../../common/services/s3-client.provider';
import { AudioRetrievalPort } from '../ports/audio-retrieval.port';

/** Counterpart to S3AudioStorageAdapter: storageKey is an S3 object key. */
@Injectable()
export class S3RetrievalAdapter implements AudioRetrievalPort {
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly config: ConfigService,
  ) {}

  async getBuffer(storageKey: string): Promise<Buffer> {
    const bucket = this.config.get<string>('s3.bucket');
    if (!bucket) {
      throw new InternalServerErrorException('S3_BUCKET_NAME is not configured');
    }

    const response = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
    const stream = response.Body as AsyncIterable<Uint8Array>;

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
