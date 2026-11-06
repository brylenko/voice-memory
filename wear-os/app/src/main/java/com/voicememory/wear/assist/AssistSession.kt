package com.voicememory.wear.assist

import android.Manifest
import android.util.Log
import androidx.annotation.RequiresPermission
import com.voicememory.wear.audio.PcmRecorder
import com.voicememory.wear.audio.toLittleEndianBytes
import com.voicememory.wear.memory.AiAvailability
import com.voicememory.wear.net.VoiceMemoryApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import org.json.JSONObject

/**
 * One "answer mode" session: mic → WebSocket → server; server events →
 * [state]. Lifetime is bound to [scope] (the ViewModel's), so leaving the
 * screen always releases the microphone and the socket.
 */
class AssistSession(
    private val api: VoiceMemoryApi,
    private val scope: CoroutineScope,
    private val language: String?,
    private val onAnswer: (String) -> Unit,
) {
    private val _state = MutableStateFlow(AssistState())
    val state: StateFlow<AssistState> = _state.asStateFlow()

    private var socket: WebSocket? = null
    private var micJob: Job? = null

    @RequiresPermission(Manifest.permission.RECORD_AUDIO)
    fun start(mode: AssistMode, save: Boolean) {
        _state.value = AssistState(status = ConnectionStatus.CONNECTING, mode = mode)
        socket = api.openAssistant(mode.wire, save, language, listener)
        micJob = scope.launch(Dispatchers.Default) { // PCM → bytes off the main thread
            // Frames are streamed immediately; the server buffers them until auth completes.
            PcmRecorder.frames(SAMPLE_RATE, FRAME_MS).collect { frame ->
                socket?.send(frame.toLittleEndianBytes().toByteString())
            }
        }
    }

    fun askNow() {
        socket?.send(JSONObject().put("type", "ask").toString())
    }

    fun setMode(mode: AssistMode) {
        _state.update { it.copy(mode = mode) }
        socket?.send(JSONObject().put("type", "mode").put("mode", mode.wire).toString())
    }

    /** Graceful stop: stop the mic, let the server flush the last utterance, then close. */
    fun stop() {
        micJob?.cancel()
        micJob = null
        val ws = socket ?: return
        _state.update { it.copy(status = ConnectionStatus.STOPPING) }
        ws.send("end")
        scope.launch {
            delay(STOP_GRACE_MS)
            ws.close(1000, "bye")
        }
    }

    /** Immediate teardown (screen left). */
    fun cancel() {
        micJob?.cancel()
        micJob = null
        socket?.cancel()
        socket = null
    }

    private val listener = object : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
            val json = runCatching { JSONObject(text) }.getOrNull() ?: return
            var effect: AssistEventReducer.Effect? = null
            _state.update { current ->
                val (next, e) = AssistEventReducer.reduce(current, json)
                effect = e
                next
            }
            when (val e = effect) {
                is AssistEventReducer.Effect.AnswerReady -> scope.launch { onAnswer(e.text) }
                AssistEventReducer.Effect.AiUnavailable -> {
                    // Pointless to keep the mic on and stream audio nobody can transcribe.
                    AiAvailability.markUnavailable()
                    micJob?.cancel()
                    webSocket.close(1000, "ai unavailable")
                }
                null -> Unit
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null) // acknowledge server-initiated close
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            micJob?.cancel()
            _state.update {
                if (it.status == ConnectionStatus.ERROR) it
                else if (code == 1008) it.copy(status = ConnectionStatus.ERROR, error = reason)
                else it.copy(status = ConnectionStatus.DONE)
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.w(TAG, "assistant socket failed", t)
            micJob?.cancel()
            _state.update {
                if (it.status == ConnectionStatus.DONE || it.status == ConnectionStatus.STOPPING) {
                    it.copy(status = ConnectionStatus.DONE)
                } else {
                    it.copy(status = ConnectionStatus.ERROR, error = t.message ?: "Connection failed")
                }
            }
        }
    }

    private companion object {
        const val TAG = "AssistSession"
        const val SAMPLE_RATE = 24_000 // backend / Realtime API contract
        const val FRAME_MS = 100
        const val STOP_GRACE_MS = 6_000L
    }
}
