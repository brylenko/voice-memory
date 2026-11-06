package com.voicememory.wear.memory

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Process-wide "can the server's AI work right now?" flag, set when the server
 * reports code `ai_unavailable` (no provider credits). While it is false the
 * watch keeps recording locally but stops streaming and uploading; it flips
 * back by itself after the server's retry-after and the next call re-checks.
 */
object AiAvailability {
    private const val DEFAULT_RETRY_S = 300L

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var restoreJob: Job? = null

    private val _available = MutableStateFlow(true)
    val available: StateFlow<Boolean> = _available.asStateFlow()

    @Synchronized
    fun markUnavailable(retryAfterSeconds: Long = DEFAULT_RETRY_S) {
        _available.value = false
        restoreJob?.cancel()
        restoreJob = scope.launch {
            delay(retryAfterSeconds.coerceIn(30, 3_600) * 1000)
            _available.value = true
        }
    }

    @Synchronized
    fun markAvailable() {
        restoreJob?.cancel()
        _available.value = true
    }

    const val WIRE_CODE = "ai_unavailable"
}
