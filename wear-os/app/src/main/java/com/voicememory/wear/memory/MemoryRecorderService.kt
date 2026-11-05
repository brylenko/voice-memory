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
import com.voicememory.wear.audio.AacFileEncoder
import com.voicememory.wear.audio.PcmRecorder
import com.voicememory.wear.audio.SegmentPolicy
import com.voicememory.wear.audio.VoiceActivityDetector
import com.voicememory.wear.ui.MainActivity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * "Memory" mode: listens all day in a foreground service, keeps only the
 * parts with speech, cuts them into conversation-sized AAC segments and hands
 * each one to WorkManager for upload. The backend transcribes, summarizes and
 * indexes them, so later you can ask "what did we agree on at lunch?".
 *
 * Commands: START, STOP, PAUSE (free the mic for assistant mode), RESUME.
 */
class MemoryRecorderService : LifecycleService() {

    private lateinit var store: SegmentStore
    private var captureJob: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        store = SegmentStore(this)
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
        captureJob = lifecycleScope.launch { captureLoop() }
    }

    @Suppress("MissingPermission") // checked in resumeCapture()
    private suspend fun captureLoop() {
        val vad = VoiceActivityDetector()
        val policy = SegmentPolicy()
        // Pre-roll: keep the last ~0.6 s so the first syllable of a sentence isn't lost.
        val preRoll = ArrayDeque<ShortArray>()
        var encoder: AacFileEncoder? = null

        fun closeSegment(keep: Boolean) {
            val enc = encoder ?: return
            encoder = null
            MemoryStatus.update { it.copy(capturingSpeech = false) }
            if (!keep) { enc.abort(); return }
            val duration = enc.durationSeconds
            val done = store.complete(enc.finish(), duration)
            SegmentUploadWorker.enqueue(this, done)
            MemoryStatus.update { it.copy(segmentsSaved = it.segmentsSaved + 1) }
            updateNotification()
        }

        try {
            PcmRecorder.frames(SAMPLE_RATE, FRAME_MS).collect { frame ->
                val speech = vad.isSpeech(frame)
                when (val action = policy.onFrame(System.currentTimeMillis(), FRAME_MS, speech)) {
                    SegmentPolicy.Action.Open -> {
                        encoder = AacFileEncoder(store.newPartFile(System.currentTimeMillis()), SAMPLE_RATE)
                            .also { enc -> preRoll.forEach(enc::encode) }
                        preRoll.clear()
                        encoder?.encode(frame)
                        MemoryStatus.update { it.copy(capturingSpeech = true) }
                    }
                    SegmentPolicy.Action.Write -> encoder?.encode(frame)
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

    private fun stopEverything() {
        captureJob?.cancel()
        captureJob = null
        releaseWakeLock()
        MemoryStatus.update { it.copy(running = false, paused = false, capturingSpeech = false) }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
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
        private const val SAMPLE_RATE = 16_000
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
