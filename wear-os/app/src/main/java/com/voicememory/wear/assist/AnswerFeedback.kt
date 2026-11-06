package com.voicememory.wear.assist

import android.content.Context
import android.media.AudioAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * How a finished answer reaches the user without looking: a short haptic tick
 * always, and optionally the answer spoken via TTS (watch speaker or BT earbuds).
 */
class AnswerFeedback(context: Context) {

    /** Why speaking is impossible right now, or null when it works. Shown in the UI. */
    enum class SpeechProblem { NO_ENGINE, NO_VOICE_FOR_LANGUAGE }

    private val vibrator = context.getSystemService(Vibrator::class.java)
    private val _problem = MutableStateFlow<SpeechProblem?>(null)
    val problem: StateFlow<SpeechProblem?> = _problem.asStateFlow()

    private var ready = false
    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
        if (!ready) {
            Log.w(TAG, "TTS init failed: $status")
            _problem.value = SpeechProblem.NO_ENGINE
        }
    }.apply {
        setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )
        setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) = Unit
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) { Log.w(TAG, "TTS error for $utteranceId") }
            override fun onError(utteranceId: String?, errorCode: Int) { Log.w(TAG, "TTS error $errorCode") }
        })
    }

    var speak: Boolean = false
        set(value) {
            field = value
            if (!value) tts.stop()
        }

    fun onAnswer(text: String) {
        vibrator?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK))
        if (!speak || text.isBlank()) return
        if (!ready) { _problem.value = SpeechProblem.NO_ENGINE; return }

        val locale = SpeechLanguage.detect(text)
        when (tts.setLanguage(locale)) {
            TextToSpeech.LANG_MISSING_DATA, TextToSpeech.LANG_NOT_SUPPORTED -> {
                // No voice for this language on the watch: better to say so than to stay silent.
                Log.w(TAG, "no TTS voice for $locale")
                _problem.value = SpeechProblem.NO_VOICE_FOR_LANGUAGE
                return
            }
        }
        _problem.value = null
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "answer-${text.hashCode()}")
    }

    fun release() {
        tts.stop()
        tts.shutdown()
    }

    private companion object {
        const val TAG = "AnswerFeedback"
    }
}
