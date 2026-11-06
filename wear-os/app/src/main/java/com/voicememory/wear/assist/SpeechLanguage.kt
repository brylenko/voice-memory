package com.voicememory.wear.assist

import java.util.Locale

/**
 * Picks a TTS locale from the answer text itself — answers follow the language
 * of the conversation, which is not necessarily the watch's system language.
 */
object SpeechLanguage {
    private val ukrainianOnly = Regex("[іїєґІЇЄҐ]")
    private val cyrillic = Regex("\\p{IsCyrillic}")

    fun detect(text: String): Locale = when {
        ukrainianOnly.containsMatchIn(text) -> Locale("uk", "UA")
        cyrillic.containsMatchIn(text) -> Locale("ru", "RU")
        else -> Locale.US
    }
}
