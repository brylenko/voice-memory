package com.voicememory.wear.audio

import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Cheap energy-based VAD with an adaptive noise floor and hang-over.
 * Runs on every frame all day long, so it must be O(n) and allocation-free —
 * no ML model: the server does the real speech recognition.
 *
 * A frame counts as speech when it is [marginDb] above the tracked noise floor
 * (and above an absolute minimum). After speech ends, [hangoverFrames] more
 * frames are still reported as speech so word endings aren't clipped.
 */
class VoiceActivityDetector(
    private val marginDb: Double = 10.0,
    private val minSpeechDbfs: Double = -50.0,
    private val hangoverFrames: Int = 25,
) {
    private var noiseFloorDb = -60.0
    private var hangover = 0

    fun isSpeech(frame: ShortArray): Boolean {
        val db = dbfs(frame)
        val loud = db > minSpeechDbfs && db > noiseFloorDb + marginDb

        // Noise floor: falls fast, rises slowly. During "loud" frames it still
        // creeps up very slowly (~15 s time constant @ 30 ms frames), so a steady
        // fan/traffic noise is eventually absorbed instead of counting as speech
        // forever, while short bursts of real speech barely move it.
        noiseFloorDb = when {
            db < noiseFloorDb -> noiseFloorDb * 0.9 + db * 0.1
            !loud -> noiseFloorDb * 0.995 + db * 0.005
            else -> noiseFloorDb * 0.998 + db * 0.002
        }

        if (loud) {
            hangover = hangoverFrames
            return true
        }
        if (hangover > 0) {
            hangover--
            return true
        }
        return false
    }

    companion object {
        fun dbfs(frame: ShortArray): Double {
            if (frame.isEmpty()) return -120.0
            var sum = 0.0
            for (s in frame) sum += s.toDouble() * s
            val rms = sqrt(sum / frame.size)
            return 20 * log10(max(rms, 1.0) / Short.MAX_VALUE)
        }
    }
}
