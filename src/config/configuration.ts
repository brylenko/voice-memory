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
  // Realtime transcription model for utterance segmentation (server VAD): /assist/live and /audio/live?vad=1.
  // Must support turn detection — gpt-realtime-whisper does not.
  realtimeVadTranscriptionModel: process.env.REALTIME_VAD_TRANSCRIPTION_MODEL ?? 'gpt-4o-transcribe',
  // Vocabulary/style hint for that model: mixed-language speech is common, and English terms
  // spoken inside Russian/Ukrainian otherwise come out transliterated ("acid" → "асид").
  realtimeTranscriptionPrompt: process.env.REALTIME_TRANSCRIPTION_PROMPT ??
    'Mixed Russian, Ukrainian and English speech. Write English words, brand names, product names ' +
    'and technical terms in Latin script as they are normally spelled, e.g. acid, Domino\'s, iPhone, API.',
  // 64 hex chars = 32 bytes = AES-256 key. Leave empty to disable field encryption (dev only).
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  device: {
    hmacSecret: process.env.DEVICE_HMAC_SECRET ?? '',
    signatureTtlSeconds: parseInt(process.env.DEVICE_SIGNATURE_TTL_SECONDS ?? '300', 10),
  },
  assistant: {
    // Ground live answers in what the watch heard earlier (one embedding + pgvector query per answer).
    memoryLookup: process.env.ASSISTANT_MEMORY_LOOKUP !== 'false',
    // Model for live assistant answers. gpt-4o-mini is cheap/fast but weak on tricky constraints;
    // a stronger one (e.g. gpt-4.1-mini, gpt-4o) answers better at a higher price per answer.
    model: process.env.ASSISTANT_MODEL ?? 'gpt-4o-mini',
    // Let the assistant search the web for current facts (prices, news, weather). The model
    // only searches when needed; each search is billed separately by OpenAI.
    webSearch: process.env.ASSISTANT_WEB_SEARCH !== 'false',
    webSearchTool: process.env.ASSISTANT_WEB_SEARCH_TOOL ?? 'web_search',
    // ISO country for local results (currency, shops), e.g. UA. Empty = no location hint.
    searchCountry: process.env.ASSISTANT_SEARCH_COUNTRY ?? '',
    // Server-side voice for answers (natural, multilingual) streamed to the watch as PCM.
    // When off, the watch falls back to its own (offline) TTS engine.
    serverTts: process.env.ASSISTANT_SERVER_TTS !== 'false',
    // DEV ONLY: log what was heard and answered (private conversation content!). Default off.
    debugLogText: process.env.ASSISTANT_DEBUG_LOG_TEXT === 'true',
    ttsModel: process.env.ASSISTANT_TTS_MODEL ?? 'gpt-4o-mini-tts',
    ttsVoice: process.env.ASSISTANT_TTS_VOICE ?? 'alloy',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/auth/google/callback',
  },
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
  // 'local' (default, good for dev/demo) or 's3' (production: unlimited scale,
  // no files piling up on the app server's disk).
  storageDriver: process.env.STORAGE_DRIVER ?? 'local',
  // How long an INITIALIZED track must be stale before we check whether the
  // S3 object actually exists. Must be longer than the presigned upload TTL
  // (default 900s / 15min) to avoid false-positives during slow uploads.
  staleUploadThresholdMinutes: parseInt(process.env.STALE_UPLOAD_THRESHOLD_MINUTES ?? '30', 10),
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
