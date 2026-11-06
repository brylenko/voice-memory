package com.voicememory.wear.assist

import android.content.Context
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
 *
 * Galaxy Watch ships Samsung TTS as the default engine, which may have no voice for
 * the answer's language; then we fall back to Google TTS (if installed) instead of
 * staying silent. Audio goes to the normal media stream so the media volume applies.
 */
class AnswerFeedback(context: Context) {

    /** Why speaking is impossible right now, or null when it works. Shown in the UI. */
    enum class SpeechProblem { NO_ENGINE, NO_VOICE_FOR_LANGUAGE }

    private val appContext = context.applicationContext
    private val vibrator = context.getSystemService(Vibrator::class.java)
    private val _problem = MutableStateFlow<SpeechProblem?>(null)
    val problem: StateFlow<SpeechProblem?> = _problem.asStateFlow()

    private var tts: TextToSpeech? = null
    private var engine: String? = null // null = system default
    private var ready = false
    private var pending: String? = null
    private var triedFallback = false

    init {
        initEngine(null)
    }

    var speak: Boolean = false
        set(value) {
            field = value
            if (!value) { tts?.stop(); speakingSince = 0; speechEndedAt = System.currentTimeMillis() }
        }

    // Half-duplex: while we talk (and a moment after), the mic must not feed our own voice
    // back to the server — otherwise the assistant answers its own answers in a loop.
    @Volatile private var speakingSince = 0L
    @Volatile private var speechEndedAt = 0L

    /** True while an answer is being (or about to be) spoken, plus a short tail for echo. */
    fun isOutputActive(now: Long = System.currentTimeMillis()): Boolean =
        speakingSince != 0L || now - speechEndedAt < ECHO_TAIL_MS

    fun onAnswer(text: String) {
        vibrator?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK))
        if (!speak || text.isBlank()) return
        if (!ready) {
            pending = text // spoken as soon as the engine finishes initialising
            return
        }
        say(text)
    }

    fun release() {
        tts?.stop()
        tts?.shutdown()
        tts = null
    }

    private fun initEngine(enginePackage: String?) {
        ready = false
        tts?.shutdown()
        engine = enginePackage
        Log.i(TAG, "init TTS engine=${enginePackage ?: "default"}")
        tts = TextToSpeech(appContext, { status ->
            ready = status == TextToSpeech.SUCCESS
            Log.i(TAG, "TTS init status=$status engine=${enginePackage ?: tts?.defaultEngine}")
            if (!ready) {
                if (!tryFallback()) _problem.value = SpeechProblem.NO_ENGINE
                return@TextToSpeech
            }
            tts?.setOnUtteranceProgressListener(progressLogger)
            pending?.let { pending = null; say(it) }
        }, enginePackage)
    }

    private fun say(text: String) {
        val engineNow = tts ?: return
        val locale = SpeechLanguage.detect(text)
        val result = engineNow.setLanguage(locale)
        Log.i(TAG, "setLanguage($locale) = $result on ${engine ?: engineNow.defaultEngine}")
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
            pending = text
            if (tryFallback()) return
            pending = null
            _problem.value = SpeechProblem.NO_VOICE_FOR_LANGUAGE
            return
        }
        _problem.value = null
        speakingSince = System.currentTimeMillis() // mute the mic from now, not from onStart
        val rc = engineNow.speak(text, TextToSpeech.QUEUE_FLUSH, null, "answer-${System.nanoTime()}")
        if (rc != TextToSpeech.SUCCESS) markSpeechEnded()
        Log.i(TAG, "speak() = $rc (${text.length} chars)")
    }

    /** Switch once to Google TTS when the default engine can't help. */
    private fun tryFallback(): Boolean {
        if (triedFallback || engine == GOOGLE_TTS) return false
        val installed = tts?.engines?.any { it.name == GOOGLE_TTS } == true
        if (!installed) return false
        triedFallback = true
        Log.i(TAG, "falling back to $GOOGLE_TTS")
        initEngine(GOOGLE_TTS)
        return true
    }

    private val progressLogger = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) { Log.i(TAG, "speaking…") }
        override fun onDone(utteranceId: String?) { Log.i(TAG, "spoken"); markSpeechEnded() }
        override fun onStop(utteranceId: String?, interrupted: Boolean) { markSpeechEnded() }
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) { Log.w(TAG, "TTS error"); markSpeechEnded() }
        override fun onError(utteranceId: String?, errorCode: Int) { Log.w(TAG, "TTS error $errorCode"); markSpeechEnded() }
    }

    private fun markSpeechEnded() {
        speakingSince = 0
        speechEndedAt = System.currentTimeMillis()
    }

    private companion object {
        const val ECHO_TAIL_MS = 600L
        const val TAG = "AnswerFeedback"
        const val GOOGLE_TTS = "com.google.android.tts"
    }
}
