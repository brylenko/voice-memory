# Voice Memory для Galaxy Watch (Wear OS)

Standalone-приложение для Samsung Galaxy Watch4 и новее (Wear OS 3+, API 30+).
Два режима работы:

| Режим | Что делает | Как работает |
|---|---|---|
| **Память** | Слушает весь день и запоминает разговоры | Foreground-сервис → VAD (только речь) → AAC-сегменты ~«один разговор» → WorkManager → `POST /audio/upload-url` → PUT → `POST /audio/upload-complete` → бэкенд: транскрипция, саммари, теги, pgvector |
| **Ассистент** | Слушает и в реальном времени даёт короткие ответы на экране (и голосом в наушники) | Микрофон PCM16 24 кГц → WebSocket `/assist/live` → серверный VAD режет речь на фразы → LLM решает, нужен ли ответ, и стримит его → вибрация + текст (+ TTS) |
| **Сегодня** | «Что я сегодня слышал» | `GET /api/memory/day` → список фрагментов + краткий итог дня от LLM |

Ассистент учитывает и **личную память**: если спросить «когда мы договорились
про демо?», он найдёт ответ в том, что часы слышали раньше (тот же
pgvector-индекс, что и RAG-поиск).

## Режимы ассистента

- **Авто** — сам отвечает, когда в разговоре звучит вопрос, просьба о факте,
  числе, дате, переводе или явно неверное утверждение. На болтовню молчит
  (модель возвращает `[SKIP]`, ответ не показывается — одно LLM-обращение
  вместо двух: классификация + ответ).
- **По тапу** — только слушает; кнопка «Ответить» даёт подсказку по последней теме.
- **Озвучка** — ответ читается через TTS (удобно с Galaxy Buds).
- Пока ассистент открыт, «Память» ставится на паузу (один микрофон), а сам
  разговор сохраняется в память (`save=1`), так что ничего не теряется.

## Сборка

Нужен Android Studio (Ladybug+) или Android SDK 35 + JDK 17.

```bash
cd wear-os
cp local.properties.example local.properties   # заполнить sdk.dir, baseUrl, hmacSecret
./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest
```

`voicememory.hmacSecret` должен совпадать с `DEVICE_HMAC_SECRET` на бэкенде.
Значения также можно передать через env `VOICEMEMORY_BASE_URL`,
`VOICEMEMORY_HMAC_SECRET`, `VOICEMEMORY_LANGUAGE` (для CI).

### Установка на часы

1. На часах: *Настройки → О часах → Сведения о ПО* → 7 раз тапнуть «Версия ПО»
   → появятся *Параметры разработчика* → включить **Отладка ADB** и **Отладка по Wi-Fi**.
2. `adb pair <ip>:<port>` (код сопряжения на часах), затем `adb connect <ip>:<port>`.
3. `./gradlew :app:installDebug`.

## Архитектура

```
ui/            Compose for Wear: Home · Assistant · Today (MVVM, StateFlow)
assist/        AssistSession (mic → WS), AssistEventReducer (чистый редьюсер протокола),
               AnswerFeedback (вибро + TTS)
memory/        MemoryRecorderService (foreground, type=microphone, OngoingActivity),
               SegmentStore (контракт имён файлов), SegmentUploadWorker (WorkManager)
audio/         PcmRecorder (Flow<ShortArray>), VoiceActivityDetector, SegmentPolicy,
               AacFileEncoder (MediaCodec → .m4a)
auth/          DeviceSigner (HMAC как в DeviceAuthGuard / WsHmacAuthService)
net/           VoiceMemoryApi (Facade над REST/WS)
AppContainer   ручной DI / composition root
```

Чистая логика (`SegmentPolicy`, `VoiceActivityDetector`, `DeviceSigner`,
`AssistEventReducer`) не зависит от Android и покрыта JVM-тестами; тест
`DeviceSignerTest` использует векторы, посчитанные Node `crypto`, — гарантия
совместимости подписи с бэкендом.

## Батарея и приватность — важно

- Постоянная запись = микрофон + partial wake lock весь день. Энергетический
  VAD дешёвый, а в сеть уходит только речь (AAC 32 кбит/с ≈ 240 КБ/мин), но
  рассчитывайте на заметно меньшее время работы часов. Загрузка идёт только
  при `batteryNotLow`.
- Режим ассистента стримит звук постоянно (~48 КБ/с) — используйте его точечно.
- Запись окружающих людей регулируется законом (во многих странах нужно
  согласие всех участников). Предупреждайте собеседников.
- Общий `DEVICE_HMAC_SECRET` вшивается в APK — это та же модель доверия, что у
  IoT-рекордера. Для публичного распространения нужна персональная выдача
  ключей устройству (provisioning) — отдельная задача.
