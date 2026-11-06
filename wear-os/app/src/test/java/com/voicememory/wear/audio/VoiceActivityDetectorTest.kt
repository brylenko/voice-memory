package com.voicememory.wear.audio

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin
import kotlin.random.Random

class VoiceActivityDetectorTest {
    private fun noise(amp: Int) = ShortArray(480) { Random.nextInt(-amp, amp + 1).toShort() }
    private fun tone(amp: Int) = ShortArray(480) { i -> (amp * sin(2 * PI * 220 * i / 16_000)).toInt().toShort() }

    @Test fun `quiet room is not speech, loud voice is, with hangover afterwards`() {
        val vad = VoiceActivityDetector(hangoverFrames = 3)
        repeat(50) { assertFalse(vad.isSpeech(noise(30))) }
        assertTrue(vad.isSpeech(tone(8_000)))
        repeat(3) { assertTrue("hangover", vad.isSpeech(noise(30))) }
        assertFalse(vad.isSpeech(noise(30)))
    }

    @Test fun `adapts to a steady noisy background`() {
        val vad = VoiceActivityDetector(hangoverFrames = 0)
        // Steady fan noise: may trigger at first, must settle as the floor adapts.
        repeat(2_000) { vad.isSpeech(noise(1_500)) }
        assertFalse(vad.isSpeech(noise(1_500)))
        assertTrue(vad.isSpeech(tone(20_000)))
    }
}
