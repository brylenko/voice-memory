package com.voicememory.wear.assist

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import java.util.concurrent.Executors

/**
 * Plays the server voice: PCM16 mono chunks arriving over the WebSocket are written
 * to a streaming AudioTrack on a dedicated thread (writes block; the socket reader
 * must not). A new `start` drops whatever is still playing — latest answer wins.
 */
class SpeechPlayer {
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "speech-player") }
    @Volatile private var track: AudioTrack? = null
    @Volatile private var currentId: String? = null
    @Volatile private var playingUntil = 0L

    /** True while audio is (or was within the echo tail) coming out of the speaker. */
    fun isOutputActive(now: Long = System.currentTimeMillis()): Boolean =
        currentId != null || now < playingUntil

    fun start(id: String, sampleRate: Int) {
        currentId = id
        worker.execute {
            releaseTrack()
            val minBuf = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
            track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(sampleRate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                )
                .setBufferSizeInBytes(maxOf(minBuf, sampleRate)) // ~0.5 s
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
                .also { it.play() }
            Log.i(TAG, "speech $id started")
        }
    }

    fun write(pcm: ByteArray) {
        if (currentId == null) return
        worker.execute {
            val t = track ?: return@execute
            t.write(pcm, 0, pcm.size)
            // Remaining playback ≈ written bytes / (2 bytes × rate); extend the echo window.
            val ms = pcm.size * 1000L / (2L * t.sampleRate)
            playingUntil = maxOf(playingUntil, System.currentTimeMillis()) + ms
        }
    }

    fun end(id: String) {
        if (currentId != id) return
        currentId = null
        playingUntil += ECHO_TAIL_MS
        // Let the buffered audio finish; the track is released on the next start/stop.
        Log.i(TAG, "speech $id received completely")
    }

    fun stop() {
        currentId = null
        playingUntil = 0
        worker.execute { releaseTrack() }
    }

    fun release() {
        stop()
        worker.shutdown()
    }

    private fun releaseTrack() {
        track?.let { runCatching { it.pause(); it.flush(); it.stop() }; it.release() }
        track = null
    }

    private companion object {
        const val TAG = "SpeechPlayer"
        const val ECHO_TAIL_MS = 600L
    }
}
