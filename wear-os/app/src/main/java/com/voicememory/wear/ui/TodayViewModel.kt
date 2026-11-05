package com.voicememory.wear.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.voicememory.wear.AppContainer
import com.voicememory.wear.net.DayMemory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.ZonedDateTime

sealed interface TodayState {
    data object Loading : TodayState
    data class Loaded(val day: DayMemory) : TodayState
    data class Failed(val message: String) : TodayState
}

class TodayViewModel(app: Application) : AndroidViewModel(app) {
    private val api = AppContainer.get(app).api
    private val _state = MutableStateFlow<TodayState>(TodayState.Loading)
    val state: StateFlow<TodayState> = _state.asStateFlow()

    init {
        // Poll while the screen is open so a live conversation shows up as it is spoken.
        // The server caches the LLM recap, so polling only costs a DB query.
        viewModelScope.launch {
            while (isActive) {
                load()
                delay(POLL_MS)
            }
        }
    }

    fun refresh() {
        _state.value = TodayState.Loading
        viewModelScope.launch { load() }
    }

    private suspend fun load() {
        val offsetMinutes = ZonedDateTime.now().offset.totalSeconds / 60
        val result = runCatching { api.getDay(offsetMinutes) }
        _state.value = result.fold(
            { TodayState.Loaded(it) },
            // Keep showing the last good data if one poll fails (flaky watch network).
            { (_state.value as? TodayState.Loaded) ?: TodayState.Failed(it.message ?: "error") },
        )
    }

    private companion object {
        const val POLL_MS = 5_000L
    }
}
