package com.voicememory.wear.audio

import android.Manifest
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.annotation.RequiresPermission
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn

/**
 * Cold Flow of PCM16 mono frames from the microphone. The AudioRecord lives
 * exactly as long as the collector (structured concurrency → no leaked mic).
 */
object PcmRecorder {

    @RequiresPermission(Manifest.permission.RECORD_AUDIO)
    fun frames(sampleRate: Int, frameMs: Int): Flow<ShortArray> = flow {
        val frameSamples = sampleRate * frameMs / 1000
        val minBuf = AudioRecord.getMinBufferSize(
            sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
        )
        val record = AudioRecord(
            // VOICE_RECOGNITION: no AGC/NS tuned for calls → cleaner input for STT.
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuf, frameSamples * 2 * 4),
        )
        check(record.state == AudioRecord.STATE_INITIALIZED) { "Microphone is unavailable" }
        try {
            record.startRecording()
            while (true) {
                currentCoroutineContext().ensureActive()
                val frame = ShortArray(frameSamples)
                var filled = 0
                while (filled < frameSamples) {
                    val n = record.read(frame, filled, frameSamples - filled)
                    if (n < 0) error("AudioRecord.read failed: $n")
                    filled += n
                }
                emit(frame)
            }
        } finally {
            runCatching { record.stop() }
            record.release()
        }
    }.flowOn(Dispatchers.IO)
}

/** Little-endian PCM16 bytes, the wire format the backend expects. */
fun ShortArray.toLittleEndianBytes(): ByteArray {
    val out = ByteArray(size * 2)
    for (i in indices) {
        val s = this[i].toInt()
        out[i * 2] = (s and 0xFF).toByte()
        out[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
    }
    return out
}
