// Central typed configuration factory consumed by @nestjs/config.
// Keeping every env read in one place avoids magic strings scattered across the app (DRY).
export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  env: process.env.ENV ?? 'development',
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'plaud',
    password: process.env.DB_PASSWORD ?? 'plaud',
    database: process.env.DB_NAME ?? 'plaud',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  device: {
    hmacSecret: process.env.DEVICE_HMAC_SECRET ?? '',
    signatureTtlSeconds: parseInt(process.env.DEVICE_SIGNATURE_TTL_SECONDS ?? '300', 10),
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  },
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
  // 'local' (default, good for dev/demo) or 's3' (production: unlimited scale,
  // no files piling up on the app server's disk).
  storageDriver: process.env.STORAGE_DRIVER ?? 'local',
  billingDriver: process.env.BILLING_DRIVER ?? 'mock',
  payment: {
    required: process.env.PAYMENT_REQUIRED === 'true',
    url: process.env.PAYMENT_URL ?? '',
    freeTracksLimit: parseInt(process.env.FREE_TRACKS_LIMIT ?? '10', 10),
  },
  s3: {
    region: process.env.AWS_REGION ?? 'eu-central-1',
    bucket: process.env.S3_BUCKET_NAME ?? '',
    // How long a presigned download URL (returned to clients / used by the
    // worker) stays valid before it needs to be re-signed.
    presignedUrlTtlSeconds: parseInt(process.env.S3_PRESIGNED_URL_TTL_SECONDS ?? '86400', 10),
    // How long the client has to actually PUT bytes after requesting an
    // upload URL (phase 1 of the direct-to-S3 upload flow) — short on purpose.
    presignedUploadUrlTtlSeconds: parseInt(
      process.env.S3_PRESIGNED_UPLOAD_URL_TTL_SECONDS ?? '900',
      10,
    ),
  },
});
