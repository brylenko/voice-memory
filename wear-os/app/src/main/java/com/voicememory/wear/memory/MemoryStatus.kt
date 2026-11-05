package com.voicememory.wear.memory

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** Process-wide observable state of memory mode (service → UI). */
object MemoryStatus {
    data class State(
        val running: Boolean = false,
        val paused: Boolean = false,
        val capturingSpeech: Boolean = false,
        val segmentsSaved: Int = 0,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    internal fun update(block: (State) -> State) = _state.update(block)
}
