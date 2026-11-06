package com.voicememory.wear.memory.sink

/**
 * Where the frames of one conversation go (Strategy pattern). The recorder
 * service drives the lifecycle; it never knows whether audio is encoded to a
 * file or streamed to the server.
 */
interface SegmentSink {
    fun write(frame: ShortArray)

    /** [keep] = false → the "conversation" was just noise; drop it. */
    fun close(keep: Boolean)
}
