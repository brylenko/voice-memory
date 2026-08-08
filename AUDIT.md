# Production Audit — voice-memory
_Дата: 2026-08-07 | Ревізор: Senior Backend Engineer | Статус: Phase 1 Complete_

---

## Загальна оцінка

Проект має сильну архітектурну основу: hexagonal ports/adapters, AES-256-GCM encryption, timing-safe HMAC. Але є кілька системних проблем у distributed consistency, idempotency та race conditions, які при production навантаженні призведуть до реальних збоїв.

---

## CRITICAL

---

### C1 — Duplicate audio_chunks при BullMQ job retry

**Файли:** `audio-processor.processor.ts:80–83`, `audio-chunk.repository.ts:32`
**Статус після Phase 1:** ✅ Виправлено (`replaceChunks` = DELETE + INSERT у транзакції)

**Failure scenario (до виправлення):**
```
Worker attempt 1:
  STT → ok (fullText готовий)
  summarize() → ok
  embedAndStoreChunks() → INSERT 5 chunks → ok
  UPDATE audio_tracks ... status=COMPLETED → process crash / network timeout
  → job не ACK-нуто → BullMQ вважає job застряглою

Worker attempt 2 (retry):
  STT → пропущено (pre-transcribed або re-transcribed)
  embedAndStoreChunks() → INSERT ще 5 chunks для того ж trackId
  UPDATE audio_tracks → COMPLETED

Результат: audio_chunks містить 10 рядків замість 5 для одного треку.
RAG пошук повертає кожен фрагмент двічі — відповідь виглядає повторювальною,
cosine distance rankings спотворені.
```

**Чому `replaceChunks` безпечний при retry/concurrency:**
- `DELETE WHERE trackId = $1` + `INSERT` виконуються в одній транзакції з `SERIALIZABLE`-рівнем (PostgreSQL гарантує атомарність)
- Якщо два workers стартують одночасно для одного trackId (race між retry і новим job): перший DELETE+INSERT завершується, другий виконує ще один DELETE+INSERT → результат ідентичний, немає дублів
- `audio_chunks` не має UNIQUE constraint на `(trackId, text)` — але DELETE зачищає всі старі рядки перед INSERT, тому кількість рядків завжди рівна кількості chunks поточного запуску

---

### C2 — S3 presigned upload URL: storageKey записується в DB до того як байти реально завантажені

**Файли:** `request-upload.service.ts:36–44`, `s3-audio-storage.adapter.ts:74–98`, `complete-upload.service.ts:30`
**Статус:** ⚠️ Не виправлено, потребує аналізу

**Failure scenario:**
```
POST /audio/upload-url:
  createUploadUrl() → S3 presigned PUT URL (TTL=900s)
  createInitialized() → DB INSERT, status=INITIALIZED, fileUrl=storageKey

  Device PUT bytes → S3 (може тривати від секунд до хвилин)
  → якщо device не завантажить файл до закінчення presigned URL TTL
     або не викличе upload-complete взагалі:

  DB: рядок з status=INITIALIZED, fileUrl="recordings/userId/uuid.ogg"
  S3: об'єкт ВІДСУТНІЙ (device так і не залив)

POST /audio/upload-complete (якщо device все ж викличе):
  queue.enqueue(storageKey) → worker намагається GetObject → S3 404
  → job FAILED після 5 retry
  → track status=FAILED
  → user бачить помилку, але audio файлу ніколи не було
```

**Чому це Critical:**
- Orphaned INITIALIZED track у DB без файлу в S3 — назавжди зависнуть якщо `upload-complete` не прийде
- Worker витрачає 5 retry (+ exponential backoff = ~10+20+40+80+160s = ~5 хвилин) на операцію, яка приречена з перших же секунд
- Немає механізму очистки INITIALIZED треків старших N хвилин

**Proposed solution (детальний аналіз):**

Варіант A (простий): Scan + alert скрипт
```
Щохвилини або через cron:
SELECT * FROM audio_tracks WHERE status='INITIALIZED' AND "createdAt" < NOW() - INTERVAL '30 minutes'
→ якщо є такі рядки → LOG WARNING
→ можливо: UPDATE status='FAILED' + S3 delete attempt
```
Це не Transactional Outbox — просто cleanup. Реалізація ~30 рядків.

Варіант B (правильний для S3): Перевірити існування об'єкта у worker перед retry
```typescript
// У processor, Step A:
try {
  audioBuffer = await this.retrieval.getBuffer(storageKey);
} catch (err) {
  if (isS3NotFoundError(err)) {
    // Не retry — файл ніколи не з'явиться
    await this.trackRepo.update(trackId, { status: AudioTrackStatus.FAILED });
    return; // або throw new PermanentError()
  }
  throw err; // transient error → retry
}
```

**Чому безпечно при retry:**
- HeadObject/GetObject — ідемпотентна read операція
- `UPDATE status=FAILED` — ідемпотентна (повторне виконання нічого не змінить)

---

### C3 — DB → Queue gap: track застрягає в INITIALIZED якщо Redis недоступний

**Файли:** `ingest-audio.service.ts:51–73`, `complete-upload.service.ts:30`
**Статус:** ⚠️ Не виправлено

**Failure scenario:**
```
IngestAudioService.execute():
  storage.save() → S3 PUT ok
  trackWriter.createInitialized() → DB INSERT ok, COMMIT
  queue.enqueue() → Redis connection refused / timeout → throws

HTTP response: 500 Internal Server Error
User: бачить помилку, аудіо "не збережено"

Реально: DB містить трек status=INITIALIZED, S3 містить файл.
Якщо user спробує ще раз → новий трек, S3 orphaned object.
Перший трек НІКОЛИ не буде оброблений автоматично.
```

**Другий варіант (CompleteUploadService):**
```
POST /audio/upload-url → DB=ok
Device PUT → S3=ok
POST /audio/upload-complete:
  queue.enqueue() → Redis timeout → throws 500
  → track status=INITIALIZED, job ніколи не стартує
```

**Чому Critical:**
- `retry-failed-tracks.ts` скрипт обробляє тільки `status=FAILED`
- INITIALIZED треки без job залишаються orphaned назавжди
- При Redis restart треки не підхоплюються автоматично

**Proposed solution:**

Найпростіший підхід: додати `BackfillInitializedCron` який прибирає застряглі INITIALIZED треки:
```typescript
// Кожні 5 хвилин:
SELECT * FROM audio_tracks
WHERE status = 'INITIALIZED' AND "createdAt" < NOW() - INTERVAL '20 minutes'
LIMIT 10

// Для кожного — перевірити чи є job у Redis (через queue.getJob(trackId))
// Якщо немає → re-enqueue → no-op якщо вже є через replaceChunks
```

**Чому безпечно при retry/concurrency:**
- `replaceChunks` (C1 fix) робить re-enqueue ідемпотентним
- Перевірка status !== INITIALIZED перед enqueue (C1 Phase 1 fix) не дасть `upload-complete` конфліктувати з cron

---

### C4 — Race condition у resolveUserId: два паралельних запити для одного telegramId/deviceId

**Файли:** `telegram-webhook.controller.ts:108–114`, `upload.controller.ts:60–66`, `streaming.gateway.ts:74–79`
**Статус:** ⚠️ Не виправлено

**Failure scenario:**
```
Два Telegram webhook запити для одного user надходять одночасно
(Telegram може retransmit незавершений webhook):

Request 1: findOneBy({ telegramId }) → null → INSERT user1
Request 2: findOneBy({ telegramId }) → null → INSERT user2 → UNIQUE VIOLATION
→ PostgreSQL кидає помилку через UNIQUE constraint на telegramId
→ Request 2 падає з 500
→ Telegram вважає що webhook не доставлений → retry знову
→ нескінченний цикл під навантаженням
```

**Реальна ймовірність:** висока при Telegram retransmission (Telegram очікує відповідь до 60s і може надіслати повторно навіть якщо сервер обробляє). Також при множинних пристроях з однаковим deviceId.

**Чому це Critical:**
- UNIQUE constraint на `users.telegramId` і `users.deviceId` існує (migration 004, 007)
- `userRepo.save(userRepo.create({telegramId}))` без `ON CONFLICT` кине виключення
- Помилка не обробляється в жодному з трьох місць
- Результат: webhook handler кидає 500 → Telegram retry → cascade failure

**Proposed solution — `INSERT ... ON CONFLICT DO NOTHING ... RETURNING *` або upsert:**
```typescript
// Замінити у всіх трьох місцях:
async resolveUserId(telegramId: string): Promise<string> {
  const result = await this.userRepo
    .createQueryBuilder()
    .insert()
    .into(UserEntity)
    .values({ telegramId })
    .orIgnore() // ON CONFLICT DO NOTHING
    .execute();

  // Якщо insert відбувся — отримати id з result
  // Якщо conflict — прочитати існуючий рядок
  const user = await this.userRepo.findOneByOrFail({ telegramId });
  return user.id;
}
```
Або ще простіше: TypeORM `upsert`:
```typescript
await this.userRepo.upsert({ telegramId }, ['telegramId']);
const user = await this.userRepo.findOneByOrFail({ telegramId });
```

**Чому безпечно при concurrency:**
- `upsert` є атомарним на рівні PostgreSQL (`INSERT ... ON CONFLICT DO UPDATE`)
- Другий паралельний запит не кине exception — просто прочитає вже існуючий рядок
- `findOneByOrFail` після upsert гарантовано знайде рядок

---

### C5 — Streaming gateway: balance check відбувається після того як аудіо почало надходити

**Файли:** `streaming.gateway.ts:107–131`
**Статус:** ⚠️ Не виправлено

**Failure scenario:**
```
handleConnection:
  Перший binary frame надходить → audioStarted = true
  audioPassthrough.push(data) → байти вже потрапили у stream
  void this.resolveUser(externalId).then(...)  ← АСИНХРОННО

  resolveUser() → DB query (наприклад 10ms)
  Тим часом: ще 5-10 binary frames надходять → потрапляють у audioPassthrough

  resolveUser() → quotaExceeded = true
  → send error → client.close()
  → audioPassthrough.push(null) не викликається одразу

  runSession() починається ПЕРЕД close через event loop
  → OpenAI WS відкривається
  → байти, які вже потрапили у stream, пересилаються в OpenAI
  → stream закривається через client disconnect
  → OpenAI billing вже відбулась (кілька секунд audio)
```

**Чому Critical:**
- Quota check відбувається ПІСЛЯ того як аудіо почало накопичуватись у stream
- При latency DB > 200ms OpenAI Realtime WS вже може відкритись та почати транскрипцію
- `resolveUser` повертає до `then()` — але OpenAI WS response приходить через `runSession` який запускається у тому ж `then()`
- Фактично: user з `quotaExceeded=true` може отримати кілька секунд безкоштовної транскрипції

**Proposed solution:**
```typescript
client.on('message', async (data, isBinary) => {
  if (isBinary) {
    if (!audioStarted) {
      audioStarted = true;
      // БЛОКУЄМО перший frame до перевірки quota
      try {
        const { id: userId, quotaExceeded } = await this.resolveUser(externalId);
        if (quotaExceeded && this.config.get<boolean>('payment.required')) {
          this.send(client, { type: 'error', ... });
          client.close();
          return;
        }
        audioPassthrough.push(data as Buffer); // тільки тепер
        void this.runSession(...);
      } catch (err) { ... }
    } else {
      audioPassthrough.push(data as Buffer);
    }
    return;
  }
  ...
});
```

**Чому безпечно при retry/concurrency:**
- `resolveUser` є ідемпотентним (upsert після C4 fix)
- Перший frame затримується на час DB query — прийнятна затримка (~10ms)
- Якщо `resolveUser` кидає — client отримує error замість мовчазного failure

---

## HIGH

---

### H1 — freeTracksUsed increment відбувається поза транзакцією з основним UPDATE

**Файли:** `audio-processor.processor.ts:90–105`
**Статус:** ⚠️ Не виправлено

**Failure scenario:**
```
Worker Step F:
  UPDATE audio_tracks SET status=COMPLETED ... → ok
  userRepo.increment({ id: userId }, 'freeTracksUsed', 1) → process crash / network timeout

Результат:
  track.status = COMPLETED (з правильними summaries, fullText, embeddings)
  users.freeTracksUsed НЕ збільшено → user отримує "безкоштовний" трек

При retry:
  job.attemptsMade > 0 → статус не змінюється назад на PROCESSING
  У processor немає перевірки "якщо status=COMPLETED — пропустити"
  → worker виконує ВСЮ обробку заново
  → STT — пропускається (pre-transcribed або повторна)
  → replaceChunks — DELETE + INSERT (ідемпотентно, ok)
  → UPDATE audio_tracks SET status=COMPLETED → no-op (вже COMPLETED)
  → freeTracksUsed.increment → ще раз!

Результат при retry: подвійне списання tracks quota.
```

**Чому це High (не Critical):**
- Для MVP з mock billing — не фінансово критично
- Але при реальному billing: подвійне списання = фінансовий збій
- При retry після DB crash: track може бути COMPLETED, але freeTracksUsed не збільшений

**Proposed solution:**

Підхід 1 — Wrap в одну транзакцію:
```typescript
await this.trackRepo.manager.transaction(async (tx) => {
  await tx.query(`UPDATE audio_tracks SET ... WHERE id = $1`, [..., trackId]);
  await tx.query(
    `UPDATE users SET "freeTracksUsed" = "freeTracksUsed" + 1 WHERE id = $1`,
    [track.userId]
  );
});
```

Підхід 2 — Перевіряти статус перед обробкою (idempotency guard):
```typescript
// На початку handleProcessAudioTrack:
const track = await this.trackRepo.findOneByOrFail({ id: trackId });
if (track.status === AudioTrackStatus.COMPLETED) {
  this.logger.warn(`[${trackId}] already COMPLETED — skipping (idempotency guard)`);
  return; // job завершується успішно, BullMQ видаляє її
}
```

**Рекомендація: обидва підходи разом.** Guard + транзакція для increment.

**Чому безпечно при retry/concurrency:**
- Transaction гарантує атомарність UPDATE tracks + UPDATE users
- Guard на початку запобігає подвійній обробці для вже COMPLETED tracks
- `freeTracksUsed` — simple counter, не може стати від'ємним через guard

---

### H2 — Telegram webhook: повторна доставка одного update_id

**Файли:** `telegram-webhook.controller.ts:69–104`
**Статус:** ⚠️ Не виправлено

**Failure scenario:**
```
Telegram надсилає webhook update_id=12345:
  Server отримує запит
  transcription.transcribe() → OpenAI STT (займає 2-5s)
  intent.classify() → OpenAI (ще 1s)
  IngestAudioService → storage.save() → S3 PUT (1-3s)

  Загальний час: ~5-10s

  Якщо НЕ отримав HTTP 200 за 10s → Telegram retransmit

Webhook retry update_id=12345 приходить:
  Та ж сама обробка починається знову
  → Ще один STT виклик (вартість $$$)
  → Ще один S3 PUT (orphaned якщо перший вже в DB)
  → Ще один DB INSERT
  → Ще один job у Redis

Результат: 2 треки з однаковим аудіо, 2 jobs у queue,
2 × summaries у Telegram, подвійне списання балансу.
```

**Реальність цього scenario:**
- Telegram timeout для webhook: 60 секунд
- STT (gpt-4o-mini-transcribe) + intent classify = 3-8s
- `IngestAudioService.execute()` (S3 PUT + DB + Redis) = ще 1-3s
- Загально: ~5-12s
- Нижче 60s → Telegram НЕ retransmit при нормальній роботі
- ALE: при завантаженому OpenAI (429 backoff, затримки до 30s+) — retransmit стає реальним
- ALE 2: network partition між Telegram і app server

**Proposed solution (мінімальний):**

Redis deduplication з TTL = 5 хвилин:
```typescript
// На початку handleUpdate():
const updateId = update.update_id;
if (updateId) {
  const key = `tg_update:${updateId}`;
  const set = await this.redis.set(key, '1', 'EX', 300, 'NX');
  if (!set) {
    this.logger.warn(`[update=${updateId}] duplicate — already processing or processed`);
    return { ok: true };
  }
}
```

**Чому безпечно при concurrency:**
- Redis `SET NX EX` — атомарна операція (set if not exists)
- Перший запит встановлює флаг, другий отримує null → повертає OK одразу
- TTL 5 хвилин покриває весь lifecycle обробки

**Trade-off:** потрібен Redis client у webhook controller. Можна обійтись без нього якщо вважати ризик прийнятним для даного scale.

---

### H3 — OpenAI calls не мають timeout — worker може зависнути назавжди

**Файли:** `openai-transcription.adapter.ts:16–18`, `openai-embedding.adapter.ts:9–13`, `openai-chat-completion.adapter.ts:9–17`, `openai-summarization.adapter.ts:62–68`
**Статус:** ⚠️ Не виправлено

**Failure scenario:**
```
worker.handleProcessAudioTrack():
  retrieval.getBuffer() → ok
  transcription.transcribe() → OpenAI SDK чекає...

  OpenAI повертає відповідь через TCP keepalive, але дані не надходять.
  Node.js HTTP client чекає без timeout.
  Job у стані "active" у Redis (не stalled — heartbeat BullMQ ще б'є).

  BullMQ stall timeout: 30s (default)
  Але якщо worker процес живий і просто чекає на відповідь →
  BullMQ НЕ вважає job stalled.
  Job зависає на невизначений час.
```

**Реальні кейси:**
- OpenAI API timeout при file upload (великий аудіофайл)
- Повільне з'єднання між workers і OpenAI CDN
- OpenAI server-side timeout (вони повертають відповідь, але дуже повільно)
- OpenAI Realtime WS: аналогічно для streaming

**Proposed solution:**

```typescript
// openai.service.ts — додати timeout при ініціалізації клієнта:
this.client = new OpenAI({
  apiKey: this.config.get<string>('openaiApiKey'),
  timeout: 120_000, // 2 хвилини максимум для будь-якого запиту
  maxRetries: 0,    // BullMQ сам керує retry
});
```

OpenAI Node SDK підтримує `timeout` та `maxRetries` на рівні клієнта. З `maxRetries: 0` SDK не буде retrying самостійно — це залишається за BullMQ.

**Чому безпечно при retry/concurrency:**
- `timeout` викидає `APITimeoutError` → BullMQ ловить → retry з backoff
- `maxRetries: 0` запобігає double retry (SDK + BullMQ)
- 120s достатньо для будь-якого розумного аудіо файлу

---

### H4 — completeUploadService не перевіряє статус після Phase 1 fix: FAILED track може бути re-queued

**Файли:** `complete-upload.service.ts:37–43`
**Статус:** ⚠️ Частково виправлено в Phase 1, але є edge case

**Failure scenario:**
```
Track проходить повну обробку:
  status → PROCESSING → FAILED (після 5 retry)

User (через device) викликає POST /audio/upload-complete ще раз:
  Phase 1 fix: throw TrackAlreadyProcessingError(trackId, 'FAILED')
  Controller: return { message: error.message } — HTTP 200

Але: FAILED трек НЕ буде оброблений знову.
User бачить "already FAILED" у відповіді але не розуміє що файл втрачений.
Якщо user хоче retry — потрібно новий upload.
```

**Це більше UX issue ніж Critical.** Поточна поведінка після Phase 1 fix: `TrackAlreadyProcessingError` для FAILED треків блокує re-enqueue навіть якщо це була б корисна операція.

**Proposed refinement:**

```typescript
// Дозволити re-enqueue для FAILED треків якщо device явно запитує retry
if (track.status === AudioTrackStatus.FAILED) {
  // Reset + re-queue
  await this.trackWriter.updateStatus(track.id, AudioTrackStatus.INITIALIZED);
  await this.queue.enqueue({...});
  return { trackId: track.id, status: AudioTrackStatus.INITIALIZED };
}
```

**Але:** це потребує додаткового методу у `AudioTrackWriterPort`. Scope decision для Phase 3.

---

### H5 — BackfillTasksCron: відсутній idempotency guard при паралельних instances

**Файли:** `backfill-tasks.cron.ts:32–60`
**Статус:** ⚠️ Частково (in-process mutex існує, але тільки для single-instance)

**Failure scenario:**
```
2 instances app (горизонтальне scaling):
  Instance A: cron tick → tasksNeeded = [track_1, track_2, ..., track_50]
  Instance B: cron tick (одночасно) → tasksNeeded = ті самі треки

Instance A: extractTasks(track_1) → LLM call
Instance B: extractTasks(track_1) → LLM call (паралельно!)

  Обидва: UPDATE audio_tracks SET summaries=encrypted_tasks WHERE id=track_1

Результат:
  2 × OpenAI calls (вартість)
  1 переможе у race, другий перезапише — tasks ідентичні, але tasks IDs різні
  (randomUUID() викликається при кожному extractTasks)
  → разові повтори tasks IDs не критичні, але billing подвоюється
```

**Proposed solution:** Для single-instance (поточний стан) — `this.running` mutex достатній. Задокументувати, що BackfillTasksCron не масштабується горизонтально без distributed lock.

---

### H6 — `handleDbLink` у CalendarCallbackService: LIKE query на truncated UUID prefix — ненульовий шанс collision

**Файли:** `calendar-callback.service.ts:248–250`
**Статус:** ⚠️ Не виправлено

**Failure scenario:**
```typescript
// Callback data: cal_db_link:<trackId[:8]>:<refId[:8]>
// Наприклад: cal_db_link:a3f7c2d1:b8e4f9a0

const track = await this.trackRepo.createQueryBuilder('t')
  .where('t.id LIKE :p', { p: `${trackIdShort}%` })
  .getOne();
```

UUID v4: `a3f7c2d1-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
Якщо у користувача є 2 треки з UUID що починається на `a3f7c2d1`:
→ `getOne()` повертає будь-який з них (невизначено)
→ не той трек буде linked до calendar event

**Ймовірність при n треків у одного user:**
- `p(collision) = 1 - (16^8-1/16^8)^n ≈ n/4294967296`
- При 1000 треків: ~0.000023% — практично нульовий ризик
- ALE: Telegram callback_data limit 64 bytes → це єдина причина truncation

**Proposed solution:** Зберігати mapping trackId ↔ shortened callback у Redis з TTL або використати числовий індекс замість UUID prefix.

**Priority рефрейм:** Це Low-Medium за реальним ризиком при поточному scale. Залишити як є або задокументувати.

---

### H7 — Telegram file download: весь аудіо файл Telegram завантажується в RAM

**Файли:** `telegram-webhook.controller.ts:75`, `telegram-api.client.ts:48–54`
**Статус:** ⚠️ Не виправлено (відомий trade-off)

**Failure scenario:**
```typescript
async downloadFile(filePath: string): Promise<Buffer> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer(); // весь файл у RAM
  return Buffer.from(arrayBuffer);
}
```

Telegram обмежує файли ботів до 20MB. При concurrency=5 workers → до 100MB RAM тільки для Telegram downloads. При concurrency=20 → 400MB.

**Реальний impact:** Обмежений через Telegram's 20MB cap. При STORAGE_DRIVER=local — файл спочатку зберігається у RAM, потім пишеться на диск.

**Proposed solution:** Не пріоритетне при поточних обмеженнях Telegram. Streaming підхід потрібен лише якщо є канали з файлами > 50MB (device upload вже streaming через presigned S3).

---

## MEDIUM

---

### M1 — `type RawPayload` у summarization adapter: відсутній validation що JSON structure валідний

**Файли:** `openai-summarization.adapter.ts:70–96`

При `responseFormatJson: true` OpenAI гарантує валідний JSON, але не гарантує наявність конкретних полів. `p.executive ?? ''` — graceful fallback. Ризик мінімальний.

---

### M2 — `extractDateWindow` в RagService: не валідує формат дат від LLM

**Файли:** `rag.service.ts:95–103`

```typescript
const parsed = JSON.parse(raw || '{}');
if (!parsed.startDate || !parsed.endDate || !parsed.cleanQuery) {
  throw new Error('Missing fields in NLU response');
}
return parsed as DateWindow;
```

Якщо LLM повертає `{ startDate: "not-a-date", ... }` → PostgreSQL отримає невалідний YYYY-MM-DD → виключення з сирим SQL замість user-friendly помилки.

**Proposed solution:**
```typescript
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
if (!dateRegex.test(parsed.startDate) || !dateRegex.test(parsed.endDate)) {
  throw new InternalServerErrorException('LLM returned invalid date format');
}
```

---

### M3 — `handleDbLink` має dead code: `if (!ref)` після вже перевіреного `!track || !ref`

**Файли:** `calendar-callback.service.ts:257–260`

```typescript
if (!track || !ref) { ... return; } // перевірка тут
const trackId = track.id;
const refTrackId = ref.id;
if (!ref) { ... return; } // мертвий код — ref вже перевірений вище
```

---

### M4 — `Google OAuth callback`: `state` параметр не валідується як UUID

**Файли:** `google-oauth.controller.ts:31`

`state` = userId UUID. Зловмисник може надіслати `?state=../../..` або будь-який рядок → `userRepo.update(state, {...})` → TypeORM виконає UPDATE WHERE id='../../..' → 0 rows affected (safe через UUID type), але не кидає error. Можна додати UUID validation.

---

### M5 — `TasksService.getOpenTasks`: завантажує ВСІ треки без LIMIT при великій кількості

**Файли:** `tasks.service.ts:21–31`

При 10,000+ COMPLETED треків у одного user → масовий DB read → TypeORM materialization у RAM → high memory.

---

## SECURITY DEEP DIVE

---

### S1 — Google OAuth `state` parameter: потенційний CSRF

**Файли:** `google-oauth.controller.ts`, `calendar-callback.service.ts:70–75`

`state` = userId (UUID) передається у OAuth URL і повертається у callback. Немає PKCE/nonce. Якщом зловмисник знає userId жертви → може спробувати OAuth CSRF:
1. Зловмисник ініціює OAuth з `state=victim_user_id`
2. Жертва відкриває URL
3. Google callback приходить з `state=victim_user_id` і токенами зловмисника
4. Токени зловмисника прив'язуються до акаунту жертви

**Реальний ризик:** Середній — потрібно знати userId жертви. Але userId не є секретним якщо є доступ до Telegram chat.

**Fix:** Генерувати CSRF token + state = `${userId}:${randomToken}`, зберігати у Redis з TTL 5хв, перевіряти при callback.

---

### S2 — `completeUploadEndpoint`: після Phase 1 fix — `deviceSerial` не перевіряється на non-empty у контролері

**Файли:** `upload.controller.ts:113`

```typescript
@Req() req: Request & { deviceSerial: string }
// deviceSerial встановлюється у DeviceAuthGuard
// Guard перевіряє HMAC — якщо guard passes, serial є
```
Це безпечно — guard вже верифікував serial. Але `resolveUserId(req.deviceSerial)` може повернути user для `''` якщо guard якось пропускає порожній serial. Малоймовірно але варто перевірити.

**DeviceAuthGuard:** `if (!serial || !timestampHeader || !signature)` → `throw UnauthorizedException` → guard ніколи не пропустить порожній serial. **Безпечно.**

---

### S3 — `audio_chunks` не має FK на `users` через indexed FK — перевірка cross-user isolation

**Файли:** `audio-chunk.repository.ts:58–84`

```sql
WHERE "userId" = $2
  AND "createdAt" >= $3::date
  AND "createdAt" <  ($4::date + INTERVAL '1 day')
```

userId завжди передається з authenticated context (device serial → userId через users table). Cross-user isolation перевірена: запити завжди фільтровані по userId. ✅

---

### S4 — `DailyBriefingCron.notified` Map — in-process state, lost on restart

**Файли:** `daily-briefing.cron.ts:36`

При restart → `notified` очищується → всі upcoming events надсилаються знову при наступному cron tick. Користувач може отримати duplicate briefing після деплою.

**Запропоноване рішення:** Зберігати `notified` у Redis з TTL 26 годин. Але для MVP — прийнятний trade-off.

---

## ПІДСУМКОВА ТАБЛИЦЯ

| # | Priority | Проблема | Failure Scenario | Impact | Складність фіксу |
|---|----------|---------|-----------------|--------|-----------------|
| C1 | ~~Critical~~ | Duplicate chunks при retry | Job retry → duplicate embeddings у RAG | RAG corruption | ✅ Виправлено |
| C2 | Critical | S3 orphaned objects при INITIALIZED без файлу | Device не заливає файл → worker fail × 5 | Stuck tracks, waste | Low |
| C3 | Critical | DB→Queue gap: INITIALIZED track без job | Redis недоступний → трек застряє назавжди | Data loss | Low |
| C4 | Critical | Race condition в resolveUserId | Паралельні webhooks → UNIQUE violation → 500 | Service crash | Low |
| C5 | Critical | Quota check після початку streaming | Quota exceeded але OpenAI billing вже йде | Фінансові витрати | Low |
| H1 | High | freeTracksUsed поза транзакцією | Crash між UPDATE tracks і increment users | Подвійне/нульове списання | Low |
| H2 | High | Telegram webhook duplicate | Telegram retransmit → 2 треки, 2× вартість | Фінансові витрати | Medium |
| H3 | High | OpenAI без timeout | TCP hang → worker зависає назавжди | Stuck workers | Trivial |
| H4 | High | FAILED трек не може бути re-queued | Device retry upload-complete для FAILED → блок | Poor UX | Low |
| H5 | High | BackfillTasksCron не scalable горизонтально | 2 instances → 2× LLM calls | Cost × 2 | Medium |
| H6 | Medium | UUID prefix collision у cal_db_link | Wrong track linked to calendar | Minor UX | Low |
| H7 | Medium | Telegram files завантажуються в RAM | 20MB × concurrency = peak memory | Memory | Low |
| M1 | Medium | Summarization JSON не валідує fields | LLM повертає неповний JSON → порожні summaries | Silent failure | Trivial |
| M2 | Medium | extractDateWindow не валідує дати | LLM повертає "not-a-date" → SQL error | Poor UX | Trivial |
| M3 | Low | Dead code `if (!ref)` в handleDbLink | — | Code quality | Trivial |
| M4 | Low | Google OAuth `state` не validated | CSRF attack якщо userId відомий | Security | Low |
| M5 | Medium | TasksService.getOpenTasks без LIMIT | 10k+ треків → high memory | Memory | Low |
| S1 | Medium | Google OAuth CSRF через state param | Token hijack | Security | Medium |
| S4 | Low | DailyBriefingCron.notified lost on restart | Duplicate briefing після деплою | UX | Low |

---

## DB → QUEUE CONSISTENCY: детальний аналіз

```
Telegram channel:
  audio.save() → S3/disk       ← окрема операція
  track.createInitialized()    ← DB INSERT (auto-commit)
  queue.enqueue()              ← Redis RPUSH

  Gap 1: S3 ok, DB fails      → S3 orphaned object (acceptable, TTL lifecycle rule)
  Gap 2: DB ok, Redis fails   → INITIALIZED track без job (C3 — Critical)
  Gap 3: Redis ok, 200 відправлено, Telegram retry → C2/H2

Device channel (two-phase):
  Phase 1: createUploadUrl() → DB INSERT INITIALIZED, S3 presigned
  Phase 2: Device PUT → S3 (може не відбутись)
  Phase 3: upload-complete → queue.enqueue()

  Gap 1: DB ok, device не заливає → S3 об'єкт ВІДСУТНІЙ (C2 — Critical)
  Gap 2: S3 ok, Redis fails → INITIALIZED без job (C3)
  Gap 3: Redis ok, device retry upload-complete → C1 (виправлено Phase 1)

Worker retry gap:
  UPDATE audio_tracks COMPLETED → ok
  freeTracksUsed.increment → crash → H1
  →retry: COMPLETED guard зупиняє (потрібно додати guard)
```

## S3 → DB CONSISTENCY

```
IngestAudioService (Telegram):
  storage.save() → S3 PUT ok
  trackWriter.createInitialized() → DB INSERT fails
  → S3 об'єкт orphaned
  → user: 500 помилка
  → orphaned object у S3 назавжди (немає cleanup)

RequestUploadService (Device):
  storage.createUploadUrl() → S3 presigned key резервується (об'єкта ще немає)
  trackWriter.createInitialized() → DB INSERT fails
  → DB помилка
  → user: 500
  → presigned URL стає недійсним через 900s (безпечно — об'єкта немає)
  → якщо device встигне PUT перед expires → orphaned S3 object
```

**Mitigation (без Transactional Outbox):**
- S3 lifecycle rule: `DELETE WHERE tag=unlinked AND age > 7 days`
- Або periodical scan: об'єкти в `recordings/` без відповідного DB рядка

---

## IDEMPOTENCY МАТРИЦЯ

| Operation | Idempotent? | Проблема | Fix |
|-----------|-------------|---------|-----|
| Telegram webhook update | ❌ | Duplicate track creation | Redis dedup (H2) |
| `upload-complete` retry | ✅ | Phase 1 fix: status guard | Виправлено |
| `embedAndStoreChunks` | ✅ | Phase 1 fix: replaceChunks | Виправлено |
| `summarize()` | ✅ | Result overwritten у DB | OK |
| `freeTracksUsed.increment` | ❌ | Double increment при retry | H1 fix потрібен |
| `resolveUserId` | ❌ | UNIQUE violation при concurrency | C4 fix потрібен |
| `UPDATE status=COMPLETED` | ✅ | UPDATE idempotent | OK |
| BullMQ job ACK | ✅ | BullMQ гарантує at-least-once | OK |
| OpenAI transcription | ✅ | Нова відповідь — той самий результат | OK |
| OpenAI embedding | ✅ | Детермінований для однакового input | OK |

---

## WORKER RETRY ANALYSIS

```
Job attempt 1 fails after:
  A) getBuffer() → S3 404 → retry OK (але марно, файлу немає — C2)
  B) transcription() → OpenAI 429 → retry OK
  C) transcription() → OpenAI timeout → зависає без timeout — H3
  D) embedAndStoreChunks() → DB error → retry → replaceChunks = idempotent ✅
  E) UPDATE audio_tracks → DB error → retry → UPDATE idempotent ✅
  F) freeTracksUsed.increment → crash → retry → double increment — H1
  G) telegram.sendMessage() → Telegram API error → retry → duplicate messages
     (але summary вже в DB — user отримає 2 повідомлення при retry після G)

Job стає COMPLETED у DB але BullMQ не ACK:
  → job вважається stalled
  → BullMQ re-queue через lockDuration (default 30s)
  → worker retry з COMPLETED guard (H1 fix) → return одразу
  → idempotent ✅
```

---

## PRODUCTION RECOMMENDATIONS (future)

1. **S3 Lifecycle Rule**: DELETE objects у `recordings/` без DB запису після 7 днів
2. **Distributed lock для BackfillTasksCron**: Redis-based lock якщо планується горизонтальне scaling
3. **Encryption key rotation**: store key version prefix у ciphertext, підтримувати N старих ключів
4. **Billing module**: замінити mock на реальну реалізацію з транзакційним списанням
5. **OpenAI cost tracking**: логувати кожен OpenAI call з моделлю + tokens + cost estimation
6. **`notified` Map в DailyBriefingCron**: перенести у Redis
7. **Google OAuth CSRF**: додати PKCE/state nonce
