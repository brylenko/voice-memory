package com.voicememory.wear.ui

import android.Manifest
import android.app.Application
import androidx.annotation.RequiresPermission
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.voicememory.wear.AppContainer
import com.voicememory.wear.assist.AnswerFeedback
import com.voicememory.wear.assist.AssistMode
import com.voicememory.wear.assist.AssistSession
import com.voicememory.wear.assist.AssistState
import com.voicememory.wear.assist.AssistTopic
import com.voicememory.wear.assist.TopicSettings
import com.voicememory.wear.memory.MemoryRecorderService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class AssistViewModel(app: Application) : AndroidViewModel(app) {
    private val container = AppContainer.get(app)
    private val feedback = AnswerFeedback(app)
    private val session = AssistSession(
        container.api, viewModelScope, container.language, feedback::onAnswer,
        micMuted = { feedback.isOutputActive() },
    )

    val state: StateFlow<AssistState> = session.state

    /** Non-null when "Speak" is on but the watch can't actually speak (no engine / no voice). */
    val speechProblem: StateFlow<AnswerFeedback.SpeechProblem?> = feedback.problem

    private val _speak = MutableStateFlow(false)
    val speak: StateFlow<Boolean> = _speak.asStateFlow()

    private var started = false

    init {
        // `ready` tells us whether the server speaks; switch local TTS off as soon as it does.
        viewModelScope.launch {
            session.state.map { it.serverTts }.distinctUntilChanged().collect { server ->
                feedback.speak = _speak.value && !server
            }
        }
    }

    @RequiresPermission(Manifest.permission.RECORD_AUDIO)
    fun start(mode: AssistMode = AssistMode.AUTO, save: Boolean = true) {
        if (started) return
        started = true
        // Only one AudioRecord at a time: memory mode hands the mic over while we answer.
        MemoryRecorderService.sendIfRunning(getApplication(), MemoryRecorderService.ACTION_PAUSE)
        TopicSettings.load(getApplication())
        session.start(mode, save, TopicSettings.topic.value)
        // Topic picked on its own screen while we're connected → apply without reconnecting.
        viewModelScope.launch {
            TopicSettings.topic.drop(1).collect { session.setTopic(it) }
        }
    }

    val topic: StateFlow<AssistTopic> = TopicSettings.topic

    fun ask() = session.askNow()

    fun toggleMode() {
        val next = if (state.value.mode == AssistMode.AUTO) AssistMode.MANUAL else AssistMode.AUTO
        session.setMode(next)
    }

    fun toggleSpeak() {
        val on = !_speak.value
        _speak.value = on
        session.setSpeak(on)
        // Local (watch) TTS only when the server can't speak; never both at once.
        feedback.speak = on && !state.value.serverTts
    }

    fun stop() = session.stop()

    override fun onCleared() {
        session.cancel()
        feedback.release()
        MemoryRecorderService.sendIfRunning(getApplication(), MemoryRecorderService.ACTION_RESUME)
    }
}
