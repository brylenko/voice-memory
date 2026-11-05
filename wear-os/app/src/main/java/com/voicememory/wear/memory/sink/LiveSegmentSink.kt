package com.voicememory.wear.memory.sink

import android.util.Log
import com.voicememory.wear.audio.toLittleEndianBytes
import com.voicememory.wear.net.VoiceMemoryApi
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.io.File
import java.util.Timer
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.schedule

/**
 * Streams one conversation to WS /audio/live (vad=1 → saved utterance by
 * utterance while people are still talking) and *at the same time* writes a
 * local AAC backup (Decorator over [FileSegmentSink]'s behaviour).
 *
 * Outcome is decided exactly once:
 *  - server says {"type":"done"} → stored → backup deleted
 *  - error / socket failure / timeout → backup goes through the normal upload path
 * so a dropped connection never loses a conversation.
 */
class LiveSegmentSink(
    api: VoiceMemoryApi,
    private val backup: (onFinished: (File) -> Unit) -> FileSegmentSink,
    language: String?,
    private val uploadBackup: (File) -> Unit,
) : SegmentSink {
    private val settled = AtomicBoolean(false)
    @Volatile private var backupFile: File? = null
    @Volatile private var serverResult: Boolean? = null // true = stored, false = failed
    private val fileSink = backup { file -> backupFile = file; settleIfReady() }
    private val timer = Timer("live-sink", true)

    private val socket: WebSocket = api.openLiveTranscription(language, listener = object : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
            when (runCatching { JSONObject(text).optString("type") }.getOrNull()) {
                "done" -> serverDone(true)
                "error" -> serverDone(false)
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = serverDone(false)

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.w(TAG, "live memory stream failed, falling back to upload: ${t.message}")
            serverDone(false)
        }
    })

    override fun write(frame: ShortArray) {
        fileSink.write(frame)
        if (serverResult == null) socket.send(frame.toLittleEndianBytes().toByteString())
    }

    override fun close(keep: Boolean) {
        if (!keep) {
            // Noise: nothing worth keeping on either path.
            socket.cancel()
            fileSink.close(false)
            settled.set(true)
            timer.cancel()
            return
        }
        socket.send("end")
        fileSink.close(true) // → backupFile set
        // Server finalize = summary + embeddings; give it time, then trust the backup.
        timer.schedule(FINALIZE_TIMEOUT_MS) { serverDone(false) }
    }

    private fun serverDone(stored: Boolean) {
        if (serverResult == null) serverResult = stored
        settleIfReady()
    }

    /** Both the backup file and the server verdict must be known. */
    private fun settleIfReady() {
        val file = backupFile ?: return
        val result = serverResult ?: return
        if (!settled.compareAndSet(false, true)) return
        timer.cancel()
        socket.cancel()
        if (result) file.delete() else uploadBackup(file)
    }

    private companion object {
        const val TAG = "LiveSegmentSink"
        const val FINALIZE_TIMEOUT_MS = 120_000L
    }
}
