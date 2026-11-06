package com.voicememory.wear.assist

/**
 * Decides which microphone frames are worth sending to the server.
 * Realtime transcription is billed per second of audio received, and an open
 * assistant mostly hears silence — so only speech (plus a little context) goes out:
 *
 *  - pre-roll: the last [preRollFrames] quiet frames are sent when speech starts,
 *    so the first syllable isn't clipped;
 *  - tail: after speech, [tailFrames] more frames are sent so the server's VAD sees
 *    the silence that ends the turn (its silence window is ~0.6 s);
 *  - muted frames (our own answer being spoken) count as silence.
 *
 * Pure logic (speech detection injected) → unit-testable without Android.
 */
class SpeechGate(
    private val isSpeech: (ShortArray) -> Boolean,
    private val preRollFrames: Int = 3,
    private val tailFrames: Int = 10,
) {
    private val preRoll = ArrayDeque<ShortArray>()
    private var tailLeft = 0

    /** Frames to send for this input frame (possibly empty, possibly with buffered pre-roll). */
    fun accept(frame: ShortArray, muted: Boolean): List<ShortArray> {
        val input = if (muted) ShortArray(frame.size) else frame
        val speech = !muted && isSpeech(frame)

        if (speech) {
            val out = ArrayList<ShortArray>(preRoll.size + 1)
            out.addAll(preRoll)
            preRoll.clear()
            out.add(input)
            tailLeft = tailFrames
            return out
        }
        if (tailLeft > 0) {
            tailLeft--
            return listOf(input)
        }
        preRoll.addLast(input)
        if (preRoll.size > preRollFrames) preRoll.removeFirst()
        return emptyList()
    }
}
