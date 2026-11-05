package com.voicememory.wear.assist

import android.content.Context
import android.os.VibrationEffect
import android.os.Vibrator
import android.speech.tts.TextToSpeech

/**
 * How a finished answer reaches the user without looking: a short haptic tick
 * always, and optionally the answer spoken via TTS (best with BT earbuds).
 */
class AnswerFeedback(context: Context) {
    private val vibrator = context.getSystemService(Vibrator::class.java)
    private var ttsReady = false
    private val tts = TextToSpeech(context.applicationContext) { status ->
        ttsReady = status == TextToSpeech.SUCCESS
    }

    var speak: Boolean = false

    fun onAnswer(text: String) {
        vibrator?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK))
        if (speak && ttsReady && text.isNotBlank()) {
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, text.hashCode().toString())
        }
    }

    fun release() {
        tts.stop()
        tts.shutdown()
    }
}
