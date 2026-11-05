package com.voicememory.wear.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.voicememory.wear.AppContainer
import com.voicememory.wear.net.DayMemory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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

    init { refresh() }

    fun refresh() {
        _state.value = TodayState.Loading
        viewModelScope.launch {
            val offsetMinutes = ZonedDateTime.now().offset.totalSeconds / 60
            _state.value = runCatching { api.getDay(offsetMinutes) }
                .fold({ TodayState.Loaded(it) }, { TodayState.Failed(it.message ?: "error") })
        }
    }
}
