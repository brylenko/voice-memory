# Plaud-style AI Voice Recorder — Backend

> ## ⚠️ IMPORTANT — read before deploying with `STORAGE_DRIVER=s3`
>
> **You must configure a CORS policy on the S3 bucket, or direct-to-S3 uploads
> will fail from any device/browser client.** A presigned URL authorizes the
> request — it does **not** bypass CORS. The device's `PUT` to `uploadUrl` is
> still a cross-origin request from the client's point of view, so without an
> explicit CORS rule allowing `PUT` (and the headers your client sends, e.g.
> `Content-Type`) from your device/app's origin, the browser or HTTP client
> will reject the upload before it ever reaches S3 — even though the presigned
> URL itself is perfectly valid.
>
> Minimal bucket CORS example:
> ```json
> [
>   {
>     "AllowedMethods": ["PUT"],
>     "AllowedOrigins": ["https://your-app-origin.example"],
>     "AllowedHeaders": ["Content-Type"],
>     "MaxAgeSeconds": 3000
>   }
> ]
> ```
> This has nothing to do with our application code — it's a one-time bucket
> setting in AWS (Console → bucket → Permissions → CORS, or via
> `PutBucketCorsCommand` / Terraform / CDK). No amount of correct code in
> `S3AudioStorageAdapter` fixes a missing CORS rule.

NestJS (TypeScript) backend for an AI voice-recorder: ingests audio from a
physical IoT device **or a Telegram bot**, transcribes it, builds a per-user
RAG index over meeting history, and answers natural-language questions like
*"What did we decide about design last Tuesday?"*.

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js 20, TypeScript, NestJS |
| **API** | Express (via `@nestjs/platform-express`), WebSocket (`ws`) |
| **Queue & async** | BullMQ, Redis |
| **Database** | PostgreSQL 16, TypeORM, pgvector (IVFFlat ANN index) |
| **AI / STT** | OpenAI Whisper (`gpt-4o-mini-transcribe`), `text-embedding-3-small`, `gpt-4o-mini` (GPT-4o mini) |
| **Storage** | Local disk (dev) / AWS S3 + presigned URLs (prod) |
| **Auth** | HMAC-SHA256 device headers, Telegram webhook secret |
| **Encryption** | AES-256-GCM at rest (`EncryptionService`) |
| **Tests** | Jest + ts-jest (19 unit tests, 0 mocks skipped) |

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Clients                                                         │
│  [Telegram Bot]  [IoT Device / Smart Glasses]  [Browser WS]    │
└────────┬─────────────────┬──────────────────────────┬───────────┘
         │ webhook         │ HMAC-signed REST          │ WebSocket PCM16
         ▼                 ▼                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  NestJS API  (Express + WebSocket gateway)                       │
│  ┌──────────────────┐  ┌────────────────────┐  ┌─────────────┐  │
│  │ TelegramWebhook  │  │ Upload Controller  │  │ Streaming   │  │
│  │ Controller       │  │ (2-phase S3 flow)  │  │ Gateway     │  │
│  └────────┬─────────┘  └────────┬───────────┘  └──────┬──────┘  │
│           │                     │                      │         │
│           └─────────────────────▼──────────────────────┘         │
│                    IngestAudioService (hexagon core)             │
│                    balance check → store → enqueue               │
└──────────────────────────────┬──────────────────────────────────┘
                               │ BullMQ job
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Worker  AudioProcessorProcessor  (concurrency=20)              │
│                                                                  │
│  download audio ──► Whisper STT ──► [parallel]                  │
│                                      ├─ Embed chunks → pgvector │
│                                      └─ Unified AI prompt ──►   │
│                                          summary + tasks + tags  │
│                                          + eventDate (1 call)    │
│                                                                  │
│  ──► AES-256-GCM encrypt ──► PostgreSQL  ──► Telegram reply     │
└─────────────────────────────────────────────────────────────────┘
                               │
                    RAG search (voice query)
                               │
              date-window NLU ─┤
              embed query      ├──► pgvector cosine top-5 ──► GPT answer
              SQL date filter ─┘
```

## Key Engineering Challenges Solved

- **Single unified AI call instead of 6.** The naive approach fires separate completions for executive summary, action items, key decisions, detailed notes, tasks, and tags — 6 serial or parallel API calls. Replaced with one structured JSON prompt that returns all fields at once, cutting latency and cost by ~6×.
- **Audio never buffered in server memory at scale.** IoT device uploads use a two-phase presigned-URL flow: phase 1 issues an S3 presigned PUT URL, phase 2 triggers processing. The server handles only two small JSON requests regardless of file size — bytes go directly client → S3.
- **Hybrid RAG keeps vector search fast as history grows.** A cheap LLM call extracts a calendar date window from the natural-language query first, narrowing the pgvector ANN scan to only that time slice. Without this, a full-table cosine scan would grow linearly with the user's recording history.
- **STT runs exactly once per recording.** The Telegram controller transcribes audio for intent classification; the text travels with the BullMQ job payload (`preTranscribedText`) so the worker skips the Whisper call entirely — no duplicate API spend.
- **BullMQ retry policy absorbs OpenAI rate limits.** Workers run with `concurrency: 20` and Bull's built-in exponential backoff on failures. A 429 from OpenAI retries transparently without surfacing an error to the user.
- **AES-256-GCM encryption at rest with zero schema changes.** `fullText` and `summaries` columns are `TEXT`/`JSONB` in PostgreSQL — the `EncryptionService` wraps/unwraps transparently before every read/write. Legacy unencrypted rows are detected by byte length and returned as-is (graceful degradation).

## Features

_(Inspired by [Plaud](https://eu.plaud.ai/) and its backend capabilities.)_

- **Voice as search** — say a question, get an instant RAG answer from your recording archive
- **Auto-detected summaries** — meeting / interview / lecture / sales call / custom templates, chosen from the transcript
- **Hybrid RAG** — NLU date-window filter + pgvector cosine search → grounded answer citing specific recordings
- **Multi-language** — summaries auto-detect and match the transcript language
- **Self-hostable** — your S3 bucket, your Postgres, your OpenAI key
- **Hexagonal architecture** — swap STT / LLM / storage without touching business logic

## Hexagonal ingestion module

Audio can arrive from more than one "channel" (device, Telegram, tomorrow maybe
WhatsApp or a browser recorder), but the business rules for accepting a
recording — check balance, store the file, create the track, enqueue
processing — must not be duplicated per channel. So `src/audio-ingest/` is
structured as ports & adapters:

```
                     ┌───────────────────────────────┐
 HTTP device upload ─┤  UploadController (inbound)    │
                     │  + DeviceAuthGuard (HMAC)       │──┐
                     └───────────────────────────────┘  │
                                                          │   INGEST_AUDIO_USE_CASE
 Telegram webhook ───┤ TelegramWebhookController (in.) │──┤   (application/ports/inbound)
                     │  + TelegramWebhookGuard          │  │
                     └───────────────────────────────┘  │
                                                          ▼
                                          ┌───────────────────────────┐
                                          │   IngestAudioService       │  <- the hexagon's core,
                                          │  (application core, 100%   │     zero framework/vendor
                                          │   business rules)          │     specifics
                                          └───────────────────────────┘
                                                          │
                     ┌───────────┬───────────┬───────────┼───────────┐
                     ▼           ▼           ▼           ▼           ▼
              AUDIO_METADATA  BALANCE   AUDIO_STORAGE  TRACK_WRITER  QUEUE
               _PORT          _CHECKER   _PORT          _PORT        _PORT
                 │              _PORT      │              │            │
                 ▼               │         ▼              ▼            ▼
        MusicMetadataAdapter     │  LocalDiskStorage  TypeOrmTrack  BullMqAudioQueue
                            MockBalanceChecker   Adapter         WriterAdapter   Adapter
```

- **Inbound (driving) adapters** — `adapters/inbound/http` and
  `adapters/inbound/telegram` — each translate one transport into an
  `IngestAudioCommand` and call `INGEST_AUDIO_USE_CASE`. They know nothing about
  balances, storage, or queues.
- **Application core** — `application/ingest-audio.service.ts` — 100% of the
  "accept a recording" business rules, talking only to outbound port
  interfaces (`AudioMetadataPort`, `BalanceCheckerPort`, `AudioStoragePort`,
  `AudioTrackWriterPort`, `AudioProcessingQueuePort`).
- **Outbound (driven) adapters** — `adapters/outbound/*` — the current,
  swappable implementations (disk storage, mock billing, TypeORM, BullMQ).
- **Composition root** — `audio-ingest.module.ts` — the only place that wires a
  port symbol to a concrete `useClass`.

## AI ports (`src/ai/`)

`RagService` and `AudioProcessorProcessor` don't import the OpenAI SDK or
`OpenAiService` directly — they depend only on outbound ports:

| Port | Used for | Current adapter |
|---|---|---|
| `TRANSCRIPTION_PORT` | audio bytes → text | `OpenAiTranscriptionAdapter` (`gpt-4o-mini-transcribe`) |
| `EMBEDDING_PORT` | text → vector(s) | `OpenAiEmbeddingAdapter` (`text-embedding-3-small`) |
| `CHAT_COMPLETION_PORT` | NLU date-parsing + grounded answers | `OpenAiChatCompletionAdapter` (`gpt-4o-mini`) |
| `SUMMARIZATION_PORT` | unified prompt → summary + tasks + tags + eventDate | `OpenAiSummarizationAdapter` (1× `gpt-4o-mini`, JSON mode) |
| `INTENT_CLASSIFIER_PORT` | classify voice as recording, search, or task command | `OpenAiIntentClassifierAdapter` (`gpt-4o-mini`, JSON mode) |

`AiModule` is `@Global()` — all bindings are in one place, model names live in exactly one file per concern.


**To add a new input channel** (WhatsApp, a browser recorder...): add a value to
`AudioSourceChannel`, write one new inbound adapter that builds an
`IngestAudioCommand`, register its controller in `AudioIngestModule`. Nothing
under `application/` changes.


## Downstream pipeline (channel-agnostic)

```
Telegram voice message
  → TelegramWebhookController
      1) download + transcribe (TRANSCRIPTION_PORT)
      2) classify intent (INTENT_CLASSIFIER_PORT)
         "recording"     → IngestAudioUseCase (store + enqueue) → reply "processing..."
         "search_query"  → RagService.ask()                     → reply with answer

BullMQ ("audio-processing") → AudioProcessorProcessor
  A) download audio from storage
  B) STT via TRANSCRIPTION_PORT (skipped if already transcribed by controller)
  C+D) parallel: embed chunks → pgvector  +  4× summarize → JSONB
  E) update status=COMPLETED, send transcript + 4-part summary to Telegram

POST /api/search/ask → RagService
  1) NLU date-window extraction (gpt-4o-mini) — defaults to last 365 days if no date mentioned
  2) embed cleaned query (text-embedding-3-small)
  3) SQL date filter + pgvector cosine search (top 5 chunks)
  4) grounded answer (gpt-4o-mini), citing meeting dates
```

**Multi-dimensional summaries** — every recording produces four sections:
- `executive` — 3–5 sentence overview for decision-makers
- `actionItems` — bulleted list of next steps with owners
- `keyDecisions` — what was decided and why
- `detailed` — full structured notes

All four are generated in parallel (`Promise.all`) and stored as JSONB.
Total end-to-end latency for a 15-second voice note: **10–20 s**.

## Why some things are done the way they are

- **`embedding` isn't a `@Column`.** TypeORM has no native `vector` type, so the
  column is created via a raw-SQL migration (`InitSchema`) and all reads/writes go
  through `AudioChunkRepository`, the single place in the app that speaks
  pgvector SQL (`::vector` casts, `<=>` cosine operator, `ivfflat` index).
- **HTTP/webhook handlers never block on AI work.** Both inbound adapters only
  validate, store, and enqueue — then return immediately (`202` for the device,
  `200` + async intent-classified reply for Telegram).
- **STT runs only once per recording.** When the Telegram controller transcribes
  audio for intent classification, the text travels with the job payload
  (`preTranscribedText`) so `AudioProcessorProcessor` skips Step B entirely —
  no duplicate API call.
- **Summarization is synchronous + parallel, not Batch API.** Four `gpt-4o-mini`
  completions fire via `Promise.all`; total latency is ~10–20 s instead of
  the 5+ minutes the OpenAI Batch API takes.
- **Two different auth mechanisms, one shape.** `DeviceAuthGuard` verifies an
  HMAC-signed header set; `TelegramWebhookGuard` verifies the secret token
  Telegram echoes back. Different transports, same job: reject anything that
  isn't the real sender before it reaches business logic.

## Getting started

### Option A — fully via Docker (recommended)

```bash
cp .env.example .env           # fill in OPENAI_API_KEY, DEVICE_HMAC_SECRET,
                                # TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, etc.
docker compose up --build
```

This builds the app image, then starts `postgres` (pgvector) → `redis` →
`app`, in that order (`depends_on: condition: service_healthy`). The app
container's entrypoint runs pending TypeORM migrations (`InitSchema`, which
creates the pgvector column/index) and only then starts the server — so a
fresh `docker compose up` on an empty database just works. Uploaded files
(when `STORAGE_DRIVER=local`) persist in the `uploads_data` named volume.

Inside the compose network, `DB_HOST`/`REDIS_HOST` are forced to `postgres`/
`redis` regardless of what your `.env` says, since `localhost` wouldn't reach
another container — see the `environment:` overrides in `docker-compose.yml`.

### Option B — Node on the host, infra in Docker

```bash
docker compose up -d postgres redis   # infra only
cp .env.example .env                  # DB_HOST/REDIS_HOST can stay 'localhost' here
npm install
npm run build
npm run migrate                       # runs InitSchema against the DB
npm start
```

## Direct-to-storage uploads (device channel)

At scale (say, 100 concurrent device uploads), the old single-request
multipart upload had our server buffer every file in memory and relay every
byte to S3 itself — real CPU/memory/egress cost that grows linearly with
concurrent uploads. The device channel now uses a two-phase flow instead:

```
1. POST /audio/upload-url        { userId, durationSeconds, fileName }
   -> DeviceAuthGuard -> RequestUploadUseCase:
        check balance, create AudioTrack(INITIALIZED), ask AudioStoragePort
        for a presigned URL
   <- { trackId, uploadUrl, expiresInSeconds }

2. device PUTs the raw audio bytes to `uploadUrl` directly
   (STORAGE_DRIVER=s3: straight to S3, our server is never in that path;
    STORAGE_DRIVER=local: streams to LocalUploadController, dev-only)

3. POST /audio/upload-complete    { trackId }
   -> DeviceAuthGuard -> CompleteUploadUseCase: enqueue processing
   <- 202 { trackId, status }
```

Step 1 is cheap and fast regardless of file size (no bytes touch our server),
so it scales to many concurrent requests the same way any small DB-write
endpoint does. `AudioProcessorProcessor`'s `@Process` handler also runs with
`concurrency: 20` (Bull defaults to 1-at-a-time otherwise) so the processing
side doesn't serialize behind a single in-flight job either.

**Known tradeoff:** since our server never receives the bytes at request time,
it can't independently verify the client-reported `durationSeconds` the way
the old flow did with `music-metadata`. `AudioProcessorProcessor` still runs
`AudioMetadataPort` after downloading the file for STT and could log/flag
large mismatches for reconciliation — not wired up yet, see TODOs below.

The Telegram channel is unaffected — Telegram already hosts the file on its
own CDN and we pull bytes once via `TelegramApiClient`, so there's no "relay
through our server" problem to solve there in the first place.

If `STORAGE_DRIVER=s3`, see the CORS notice at the very top of this README —
it's the single most common reason a working presigned-URL setup still fails
in the browser/device client.

### Switching audio storage from local disk to S3

Local disk is fine for a demo but doesn't scale — thousands of recordings
piling up on the app server's disk, no redundancy, no easy multi-instance
deployment. Flip one env var instead of changing code:

```bash
STORAGE_DRIVER=s3
AWS_REGION=eu-central-1
S3_BUCKET_NAME=plaud-recordings
```

What actually happens under the hood: `AudioIngestModule` binds
`AUDIO_STORAGE_PORT` to `S3AudioStorageAdapter` instead of
`LocalDiskStorageAdapter` (both are registered providers either way — a config
value just picks which one satisfies the port), and `QueueModule` binds the
matching `AUDIO_RETRIEVAL_PORT` to `S3RetrievalAdapter` so the worker knows how
to read the S3 key back. `IngestAudioService`, `UploadController`,
`TelegramWebhookController`, and `AudioProcessorProcessor` are all completely
unaware which one is active — that's the point of the ports.

Credentials: leave `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` unset when
deploying on EC2/ECS/Lambda with an IAM role attached — the AWS SDK's default
credential chain picks that up automatically. Set them only for local
development against a real bucket.

### Wiring up Google Calendar

After completing steps 1–4 for Telegram, optionally enable smart calendar tags:

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. **Create credentials → OAuth 2.0 Client ID**, type: **Web application**
3. Authorized redirect URIs: `https://<your-domain>/auth/google/callback`
4. In [Library](https://console.cloud.google.com/apis/library) enable **Google Calendar API**
5. Add to `.env`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://your-domain/auth/google/callback
```

**How it works:** when a recording is tagged with a meeting-type word (`зустріч`, `call`, `meeting`, `нарада`, `конференція`, ...) the Telegram summary includes a 📅 button. The first click sends the user a Google OAuth link. After authorization, subsequent clicks show a live list of **upcoming events only** (past events are filtered out). Selecting an event saves `calendarEventId` + event title to the track in the DB.

Tokens are stored in `users.googleAccessToken/RefreshToken/TokenExpiry` and refreshed automatically on each Calendar request. Scope: `calendar.readonly`.

### Wiring up the Telegram channel

1. Create a bot with @BotFather, put its token in `TELEGRAM_BOT_TOKEN`.
2. Pick any secret string for `TELEGRAM_WEBHOOK_SECRET`.
3. Register the webhook once your server is publicly reachable:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=${PUBLIC_BASE_URL}/telegram/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

4. Send a voice message to the bot — it will reply once processing starts and
   the RagService/search endpoint works identically regardless of which
   channel the recording came from (both end up as a normal `AudioTrackEntity`
   with `channel: 'telegram'`).

## Smart glasses integration

The backend is ready to accept audio from smart glasses out of the box — no backend changes required. Glasses are just another inbound channel on top of the existing WebSocket streaming endpoint.

### Protocol

```
WebSocket: ws(s)://your-server/audio/live?deviceId=<device-serial>&lang=en

Client → Server:
  binary frames   — PCM16 mono 24 kHz, ~100 ms chunks
  text "end"      — signals end of recording

**Auth trade-off vs REST channel:** The REST channel (`/audio/upload-url`) requires an
HMAC-SHA256 signature (`X-Device-Serial` + `X-Timestamp` + `X-Signature`) — cryptographic
proof that the sender owns the serial. The WebSocket channel only has the serial as a plain
query param — identification, not authentication. Anyone who knows a serial can stream under
its identity. This is an accepted trade-off while serials are opaque and non-enumerable.
To reach REST-level parity, add HMAC in a query param or in the first binary frame of the
handshake — see `DeviceAuthGuard` for the signing scheme.

Server → Client:
  {"type":"transcript","text":"..."}               — live word-by-word delta
  {"type":"done","fullText":"...","trackId":"..."}  — final transcript + track id
  {"type":"error","message":"..."}                  — something went wrong
```

After `done`, the track is fully indexed: tags extracted, embeddings stored in pgvector, full-text search vector updated — immediately queryable via voice search.

### Example: Frame by Brilliant Labs (TypeScript/Node companion app)

Frame glasses connect to a companion app on the user's phone over Bluetooth. The companion app streams mic audio to our backend over WebSocket:

```typescript
import WebSocket from 'ws';

// Called by the Frame Bluetooth SDK when audio chunk arrives
export async function streamToBackend(userId: string) {
  const ws = new WebSocket(`wss://your-server/audio/live?userId=${userId}&lang=en`);

  await new Promise<void>(resolve => ws.on('open', resolve));

  // Wire Frame mic → WebSocket
  frame.microphone.on('data', (pcm16Chunk: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(pcm16Chunk);
  });

  // Show live transcript on Frame display
  ws.on('message', (raw) => {
    const event = JSON.parse(raw.toString());
    if (event.type === 'transcript') frame.display.showText(event.text);
    if (event.type === 'done')       frame.display.showText('✓ Saved');
  });

  // Stop recording → send EOF
  frame.microphone.on('stop', () => ws.send('end'));
}
```

### Example: Meta Ray-Ban (via Meta Orion SDK)

Meta glasses expose a media stream via the Orion SDK. Pipe it to our endpoint:

```typescript
import WebSocket from 'ws';
import { OrionSession } from '@meta/orion-sdk';

export async function streamToBackend(userId: string) {
  const session = await OrionSession.create();
  const ws = new WebSocket(`wss://your-server/audio/live?userId=${userId}&lang=en`);

  await new Promise<void>(resolve => ws.on('open', resolve));

  session.audio.on('chunk', (pcm: Buffer) => ws.send(pcm));
  session.audio.on('end',   ()           => ws.send('end'));

  ws.on('message', (raw) => {
    const event = JSON.parse(raw.toString());
    if (event.type === 'transcript') session.display.setText(event.text);
    if (event.type === 'done')       session.display.setText('✓ Saved to memory');
  });
}
```

### Audio requirements

| Parameter | Value |
|---|---|
| Format | PCM 16-bit signed little-endian |
| Sample rate | 24 000 Hz |
| Channels | Mono |
| Chunk size | ~100 ms (~4 800 samples per chunk) |

Any glasses that can output PCM audio over Bluetooth or WiFi can integrate with this backend using the same pattern.

## Live transcription test page

Available in development (`ENV=development`) at `GET /public/stream-test.html`.

Opens a browser mic, streams PCM audio over WebSocket to the server, which pipes it to the OpenAI Realtime API and pushes partial transcription tokens back in real time. The final transcript is displayed alongside the live stream and can be submitted for full processing (summarization, RAG indexing).

Not served in production — the static middleware is only mounted when `ENV=development`.

## Endpoints

- `POST /audio/upload-url` — phase 1, `X-Device-Serial/Timestamp/Signature`
  headers required, body: `{ durationSeconds, fileName }`. The `userId` is
  resolved automatically from `X-Device-Serial` — the device serial is looked
  up in the `users` table and a new user row is created on first contact.
  Returns `200` with `{ trackId, uploadUrl, expiresInSeconds }`.
- `POST /audio/upload-complete` — phase 2, same device headers, body:
  `{ trackId }`. Returns `202` with `{ trackId, status }`.
- `POST /telegram/webhook` — Telegram Update payload, guarded by
  `X-Telegram-Bot-Api-Secret-Token`. Not meant to be called manually.
- `POST /api/search/ask` — same `X-Device-Serial/Timestamp/Signature` headers
  as upload, body: `{ query }`. `userId` is resolved from the serial — no
  user id in the request body. Returns the grounded answer, the resolved date
  window, and the source chunks used.
- `GET /health` — returns `{ status: "ok" }` after a live DB ping. Used by
  orchestrators (ECS/k8s) to distinguish "up" from "up but broken".

## Path to production — known gaps, ranked by severity

### 🔴 Blockers — do not deploy without these

**Two quota gates — understand the model before enabling either:**
There are two independent quota mechanisms. They are intentionally separate tiers, not duplicates:
- `freeTracksUsed` / `FREE_TRACKS_LIMIT` — **free tier gate** (tracks count). Active in the WebSocket gateway right now. Flip `PAYMENT_REQUIRED=true` to enforce it.
- `BalanceCheckerPort` / minutes — **paid tier gate** (minutes consumed). Wired correctly in `IngestAudioService`, but `MockBalanceCheckerAdapter` always returns 999 minutes — it is a stub. Replace with a real adapter backed by a `wallets` table and payment-provider webhooks (Stripe etc.) before charging users.

A user hits the free gate first (track count). Once they upgrade, the minutes gate takes over. Make sure both thresholds are configured consistently or users can be blocked earlier than expected.

- **`MockBalanceCheckerAdapter` (`src/billing/`) is a mock** — always reports
  999 minutes and only logs consumption instead of persisting it. Set
  `BILLING_DRIVER=real` and implement a real adapter backed by a
  `wallets`/`subscriptions` table and a payment-provider webhook (Stripe etc.)
  for top-ups. The consume logic in `AudioProcessorProcessor` is already wired
  correctly — only the adapter needs replacing.
- **Free-quota gate** — every user has a `freeTracksUsed` counter (DB column).
  After each successfully processed recording it is incremented automatically
  (both the HTTP upload path and the WebSocket live path). Set
  `PAYMENT_REQUIRED=true` + `PAYMENT_URL=https://…` + `FREE_TRACKS_LIMIT=10`
  (default 10) to block connections once the free quota is exhausted: the
  WebSocket handshake will complete but on the first audio frame the gateway
  sends `{"type":"error","message":"Free quota exceeded…","paymentUrl":"…"}`
  and closes the connection. With `PAYMENT_REQUIRED=false` (default) the counter
  still increments — flip the flag any time without a deploy to enable the gate.

### 🟡 Should fix before/soon after launch

- Duration reconciliation: `RequestUploadUseCase` trusts the client-reported
  `durationSeconds` for the balance pre-check (see "Direct-to-storage
  uploads" above); `AudioProcessorProcessor` could compare it against the
  real duration from `AudioMetadataPort` after download and flag/adjust large
  mismatches — not implemented.
- **WebSocket auth gap** — the REST channel verifies device ownership via HMAC-SHA256 (`DeviceAuthGuard`); the WebSocket channel only identifies the device by serial number in a query param — no cryptographic proof. Add HMAC in the handshake query or first binary frame to reach parity. Acceptable while serials are opaque and non-enumerable; not acceptable if serials are ever logged or shared.
- No app-level rate limiting — relying entirely on OpenAI's own limits.
- One static HMAC secret for all devices — no per-device secret or rotation.
- Secrets currently come from `.env` / plain environment variables — move to
  AWS Secrets Manager / SSM Parameter Store before production.
- No retry/backoff around `RagService`'s synchronous OpenAI calls — a 429
  there surfaces directly to the user instead of retrying.
- No structured logging or error tracking (Sentry/Datadog) — just `Logger` to
  stdout.

### 🟢 Tuning, not correctness

- Storage already supports S3 (`STORAGE_DRIVER=s3`, see above) — for a CDN in
  front of it, have `S3AudioStorageAdapter` return a CloudFront URL instead of
  a presigned S3 URL for `publicUrl` (the presigned URL is still fine as the
  private key the worker downloads from).
- `@Process({ concurrency: 20 })` is a starting point, not a tuned number —
  raise it further, or run multiple worker replicas against the same Redis
  queue, once you know your actual OpenAI rate-limit tier.
- `NotificationService` is a logging stub for non-Telegram tracks — push
  notification integration (FCM/APNs) not implemented yet.
- Both channels resolve a canonical `userId` automatically — Telegram via
  `telegramId`, IoT device via `deviceId` (serial from `X-Device-Serial`).
  Each new serial/telegramId gets a fresh UUID row in `users` on first contact;
  subsequent requests reuse the same row. Account-linking between the two
  channels (one person, one Telegram + one device) is not implemented yet.

## How vector search works

A detailed breakdown of the full pipeline — from raw transcript to semantic retrieval — for technical readers and portfolio purposes.

### Step 1 — Chunking

After transcription, the full text is split into chunks of ~800 characters using `chunkTextBySentence()`. Splits always happen on sentence boundaries, not character offsets, so each chunk carries a complete thought and its embedding stays semantically coherent.

```
"We discussed the budget. John will prepare the report by Friday.
The client asked about pricing..."

→ chunk 1: "We discussed the budget. John will prepare the report by Friday."
→ chunk 2: "The client asked about pricing..."
```

### Step 2 — Embedding

Each chunk is sent to **OpenAI `text-embedding-3-small`**, which returns a **1 536-dimensional float vector** representing the semantic meaning of that text. All chunks from the same recording are embedded in a single batched API call.

### Step 3 — Storage (pgvector)

Vectors are stored in PostgreSQL via the **pgvector** extension in a native `vector(1536)` column. An **IVFFlat approximate nearest-neighbour index** with cosine distance is created on that column so queries scale sub-linearly as the corpus grows:

```sql
CREATE INDEX idx_audio_chunks_embedding_cosine
ON audio_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

TypeORM has no native `vector` column type, so the column is created via raw SQL migration and all reads/writes go through `AudioChunkRepository` — the single place in the codebase that speaks the `::vector` cast and the `<=>` cosine-distance operator.

### Step 4 — Hybrid RAG query

When the user asks a question (voice or text), retrieval runs in two stages:

**Stage A — date-window extraction (cheap, exact)**

A lightweight LLM call parses the natural-language query and extracts a calendar window (`startDate`, `endDate`). This filters the search space to only relevant recordings before the expensive vector step runs. If no date is mentioned, the window defaults to the last 365 days.

**Stage B — cosine similarity search**

The cleaned query text is embedded with the same model. PostgreSQL finds the top-5 most similar chunks within the date window:

```sql
SELECT text, "createdAt", embedding <=> $1::vector AS distance
FROM audio_chunks
WHERE "userId" = $2
  AND "createdAt" >= $3::date
  AND "createdAt" <  ($4::date + INTERVAL '1 day')
ORDER BY distance ASC
LIMIT 5
```

The retrieved chunks are passed as grounded context to an LLM, which generates an answer citing only what was actually said in those recordings — no hallucination from training data.

### Design decisions

| Decision | Reason |
|---|---|
| Sentence-boundary chunking | Mid-sentence splits degrade embedding quality; complete thoughts embed more accurately |
| `text-embedding-3-small` | Best cost/quality ratio for retrieval at this corpus size |
| Date pre-filter before vector scan | Avoids full-table ANN scan as history grows to thousands of chunks |
| IVFFlat over exact KNN | Sub-linear query time at the cost of a small recall margin — acceptable for conversational search |
| Raw SQL for vector ops | TypeORM has no `vector` type; raw SQL keeps the ORM entity honest and the pgvector logic in one file |
| STT runs once per recording | Telegram controller transcribes for intent classification; the text travels with the job payload so the processor skips a duplicate API call |

