package com.voicememory.wear.audio

/**
 * Pure decision logic for cutting the all-day stream into uploadable segments.
 * Separated from the service so it can be unit-tested without Android.
 *
 * Only voiced audio is written, so a segment is roughly "one conversation".
 */
class SegmentPolicy(
    /** Cap on speech per segment — keeps uploads small and transcription latency low. */
    private val maxVoicedMs: Long = 5 * 60_000L,
    /** This much silence means the conversation is over → close the segment. */
    private val closeAfterSilenceMs: Long = 45_000L,
    /** Hard cap on wall-clock time a segment may stay open. */
    private val maxOpenMs: Long = 15 * 60_000L,
    /** Segments with less speech than this are just noise (cough, door) → discard. */
    val minVoicedMs: Long = 3_000L,
) {
    var isOpen = false
        private set
    var voicedMs = 0L
        private set
    private var openedAt = 0L
    private var lastSpeechAt = 0L

    sealed interface Action {
        data object None : Action
        data object Open : Action
        data object Write : Action
        /** [keep] = enough speech to be worth uploading. */
        data class Close(val keep: Boolean) : Action
    }

    fun onFrame(nowMs: Long, frameMs: Int, speech: Boolean): Action {
        if (!isOpen) {
            if (!speech) return Action.None
            isOpen = true
            openedAt = nowMs
            lastSpeechAt = nowMs
            voicedMs = frameMs.toLong()
            return Action.Open
        }
        if (speech) {
            lastSpeechAt = nowMs
            voicedMs += frameMs
            if (voicedMs >= maxVoicedMs || nowMs - openedAt >= maxOpenMs) return close()
            return Action.Write
        }
        if (nowMs - lastSpeechAt >= closeAfterSilenceMs || nowMs - openedAt >= maxOpenMs) return close()
        return Action.None
    }

    /** Force-close (pause/stop). */
    fun flush(): Action = if (isOpen) close() else Action.None

    private fun close(): Action {
        val keep = voicedMs >= minVoicedMs
        isOpen = false
        voicedMs = 0
        return Action.Close(keep)
    }
}
