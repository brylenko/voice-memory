package com.voicememory.wear.memory

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import com.voicememory.wear.R
import com.voicememory.wear.AppContainer
import com.voicememory.wear.audio.PcmRecorder
import com.voicememory.wear.audio.SegmentPolicy
import com.voicememory.wear.audio.VoiceActivityDetector
import com.voicememory.wear.memory.sink.FileSegmentSink
import com.voicememory.wear.memory.sink.LiveSegmentSink
import com.voicememory.wear.memory.sink.SegmentSink
import com.voicememory.wear.ui.MainActivity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import java.io.File

/**
 * "Memory" mode: listens all day in a foreground service, keeps only the
 * parts with speech and cuts them into conversation-sized pieces. Each
 * conversation goes to the backend by one of two transports (hybrid):
 *  - LIVE     — on the charger or unmetered Wi-Fi: streamed to /audio/live,
 *               saved utterance by utterance in real time (with a local backup)
 *  - SEGMENTS — otherwise: AAC file, uploaded by WorkManager when possible
 * The backend transcribes, summarizes and indexes everything, so later you can
 * ask "what did we agree on at lunch?".
 *
 * Commands: START, STOP, PAUSE (free the mic for assistant mode), RESUME.
 */
class MemoryRecorderService : LifecycleService() {

    private lateinit var store: SegmentStore
    private lateinit var conditions: DeviceConditionsMonitor
    private var captureJob: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        store = SegmentStore(this)
        conditions = DeviceConditionsMonitor(this).also { it.start() }
        TransportSettings.load(this)
        combine(conditions.state, TransportSettings.preference) { c, pref -> TransportPolicy.choose(c, pref) }
            .onEach { t -> MemoryStatus.update { it.copy(transport = t) } }
            .launchIn(lifecycleScope)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action ?: ACTION_START) {
            ACTION_START -> start()
            ACTION_PAUSE -> pause()
            ACTION_RESUME -> resumeCapture()
            ACTION_STOP -> stopEverything()
        }
        return START_STICKY
    }

    private fun start() {
        startInForeground()
        // Re-queue anything left over from a previous run (crash, reboot, no network).
        store.deleteOrphanParts()
        store.pendingUploads().forEach { SegmentUploadWorker.enqueue(this, it) }
        MemoryStatus.update { it.copy(running = true, paused = false, error = null) }
        resumeCapture()
    }

    private fun pause() {
        captureJob?.cancel()
        captureJob = null
        releaseWakeLock()
        MemoryStatus.update { it.copy(paused = true, capturingSpeech = false) }
    }

    private fun resumeCapture() {
        if (captureJob?.isActive == true || !MemoryStatus.state.value.running) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            MemoryStatus.update { it.copy(error = getString(R.string.mic_permission_needed)) }
            stopEverything()
            return
        }
        acquireWakeLock()
        MemoryStatus.update { it.copy(paused = false) }
        // Default dispatcher: VAD + AAC encoding (blocking MediaCodec calls) run ~33×/s
        // and must never touch the main thread, or the whole watch UI stutters.
        captureJob = lifecycleScope.launch(Dispatchers.Default) { captureLoop() }
    }

    @Suppress("MissingPermission") // checked in resumeCapture()
    private suspend fun captureLoop() {
        val vad = VoiceActivityDetector()
        val policy = SegmentPolicy()
        // Pre-roll: keep the last ~0.6 s so the first syllable of a sentence isn't lost.
        val preRoll = ArrayDeque<ShortArray>()
        var sink: SegmentSink? = null

        fun closeSegment(keep: Boolean) {
            val current = sink ?: return
            sink = null
            MemoryStatus.update { it.copy(capturingSpeech = false) }
            current.close(keep)
            if (keep) {
                MemoryStatus.update { it.copy(segmentsSaved = it.segmentsSaved + 1) }
                updateNotification()
            }
        }

        try {
            PcmRecorder.frames(SAMPLE_RATE, FRAME_MS).collect { frame ->
                val speech = vad.isSpeech(frame)
                when (val action = policy.onFrame(System.currentTimeMillis(), FRAME_MS, speech)) {
                    SegmentPolicy.Action.Open -> {
                        sink = openSink(System.currentTimeMillis()).also { s ->
                            preRoll.forEach(s::write)
                            s.write(frame)
                        }
                        preRoll.clear()
                        MemoryStatus.update { it.copy(capturingSpeech = true) }
                    }
                    SegmentPolicy.Action.Write -> sink?.write(frame)
                    is SegmentPolicy.Action.Close -> closeSegment(action.keep)
                    SegmentPolicy.Action.None -> {
                        if (!policy.isOpen) {
                            preRoll.addLast(frame)
                            if (preRoll.size > PRE_ROLL_FRAMES) preRoll.removeFirst()
                        }
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "capture failed", e)
            MemoryStatus.update { it.copy(error = e.message) }
        } finally {
            // Paused/stopped mid-conversation: keep what we have if it's meaningful.
            val flush = policy.flush()
            closeSegment(flush is SegmentPolicy.Action.Close && flush.keep)
        }
    }

    /** Transport is chosen once per conversation, never switched mid-way. */
    private fun openSink(startedAtMs: Long): SegmentSink {
        // applicationContext: a live upload may settle after the service is gone.
        val upload: (File) -> Unit = { SegmentUploadWorker.enqueue(applicationContext, it) }
        val file = { onFinished: (File) -> Unit -> FileSegmentSink(store, SAMPLE_RATE, startedAtMs, onFinished) }
        return when (TransportPolicy.choose(conditions.state.value, TransportSettings.preference.value)) {
            Transport.SEGMENTS -> file(upload)
            Transport.LIVE -> {
                val container = AppContainer.get(this)
                LiveSegmentSink(container.api, file, container.language, upload) { heard ->
                    MemoryStatus.update { it.copy(lastHeard = heard) }
                }
            }
        }
    }

    private fun stopEverything() {
        captureJob?.cancel()
        captureJob = null
        releaseWakeLock()
        MemoryStatus.update { it.copy(running = false, paused = false, capturingSpeech = false) }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        conditions.stop()
        releaseWakeLock()
        MemoryStatus.update { it.copy(running = false, capturingSpeech = false) }
        super.onDestroy()
    }

    // --- foreground plumbing -------------------------------------------------

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW),
        )
        ServiceCompat.startForeground(
            this, NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
        )
    }

    private fun updateNotification() {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
    }

    private fun buildNotification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1, command(this, ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        val text = getString(R.string.notif_memory_text, MemoryStatus.state.value.segmentsSaved)
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_mic)
            .setContentTitle(getString(R.string.notif_memory_title))
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(0, getString(R.string.action_stop), stop)

        // Wear OS "ongoing activity": shows a mic chip on the watch face / recents.
        OngoingActivity.Builder(this, NOTIFICATION_ID, builder)
            .setStaticIcon(R.drawable.ic_mic)
            .setTouchIntent(open)
            .setStatus(Status.Builder().addTemplate(text).build())
            .build()
            .apply(this)

        return builder.build()
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        // Without it the CPU sleeps when the screen turns off and AudioRecord starves.
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "VoiceMemory:capture")
            .apply { setReferenceCounted(false); acquire() }
    }

    private fun releaseWakeLock() {
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
    }

    companion object {
        private const val TAG = "MemoryRecorder"
        private const val CHANNEL_ID = "memory"
        private const val NOTIFICATION_ID = 42
        private const val SAMPLE_RATE = 24_000 // = /audio/live contract; also fine for AAC
        private const val FRAME_MS = 30
        private const val PRE_ROLL_FRAMES = 20

        const val ACTION_START = "com.voicememory.wear.memory.START"
        const val ACTION_STOP = "com.voicememory.wear.memory.STOP"
        const val ACTION_PAUSE = "com.voicememory.wear.memory.PAUSE"
        const val ACTION_RESUME = "com.voicememory.wear.memory.RESUME"

        fun command(context: Context, action: String): Intent =
            Intent(context, MemoryRecorderService::class.java).setAction(action)

        fun start(context: Context) =
            ContextCompat.startForegroundService(context, command(context, ACTION_START))

        /** Only sends a command if memory mode is actually on (never starts it implicitly). */
        fun sendIfRunning(context: Context, action: String) {
            if (MemoryStatus.state.value.running) context.startService(command(context, action))
        }
    }
}
