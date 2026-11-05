package com.voicememory.wear.memory.sink

import com.voicememory.wear.audio.AacFileEncoder
import com.voicememory.wear.memory.SegmentStore
import java.io.File

/**
 * Encodes a conversation into an .m4a in [SegmentStore] and hands the finished
 * file to [onFinished] (normally: enqueue an upload).
 */
class FileSegmentSink(
    private val store: SegmentStore,
    sampleRate: Int,
    startedAtMs: Long,
    private val onFinished: (File) -> Unit,
) : SegmentSink {
    private val encoder = AacFileEncoder(store.newPartFile(startedAtMs), sampleRate)

    override fun write(frame: ShortArray) = encoder.encode(frame)

    override fun close(keep: Boolean) {
        if (!keep) { encoder.abort(); return }
        val duration = encoder.durationSeconds
        onFinished(store.complete(encoder.finish(), duration))
    }
}
