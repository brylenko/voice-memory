import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';

export const S3_CLIENT = Symbol('S3_CLIENT');

/**
 * Single shared S3Client for the whole app (ingest-side upload adapter +
 * worker-side retrieval adapter both inject this rather than each creating
 * their own). Deliberately omits explicit credentials: the AWS SDK's default
 * credential provider chain picks up AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY
 * from the environment if present, or an IAM role automatically when running
 * on EC2/ECS/Lambda — no code change needed between local and deployed.
 */
export function createS3Client(config: ConfigService): S3Client {
  return new S3Client({ region: config.get<string>('s3.region') });
}
