package com.voicememory.wear.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class SegmentPolicyTest {
    private val frame = 30

    @Test fun `opens on speech, writes while talking, closes after long silence`() {
        val p = SegmentPolicy(closeAfterSilenceMs = 1_000, minVoicedMs = 60)
        var t = 0L
        assertEquals(SegmentPolicy.Action.None, p.onFrame(t, frame, false))
        assertEquals(SegmentPolicy.Action.Open, p.onFrame(t, frame, true))
        t += frame; assertEquals(SegmentPolicy.Action.Write, p.onFrame(t, frame, true))
        t += frame; assertEquals(SegmentPolicy.Action.Write, p.onFrame(t, frame, true))
        t += 500; assertEquals(SegmentPolicy.Action.None, p.onFrame(t, frame, false))
        t += 600; assertEquals(SegmentPolicy.Action.Close(keep = true), p.onFrame(t, frame, false))
    }

    @Test fun `discards segments that are too short to be speech`() {
        val p = SegmentPolicy(closeAfterSilenceMs = 100, minVoicedMs = 3_000)
        p.onFrame(0, frame, true)
        assertEquals(SegmentPolicy.Action.Close(keep = false), p.onFrame(200, frame, false))
    }

    @Test fun `cuts long monologues at the voiced cap`() {
        val p = SegmentPolicy(maxVoicedMs = 90, minVoicedMs = 0)
        p.onFrame(0, frame, true)
        p.onFrame(30, frame, true)
        assertEquals(SegmentPolicy.Action.Close(keep = true), p.onFrame(60, frame, true))
    }

    @Test fun `flush closes an open segment only`() {
        val p = SegmentPolicy(minVoicedMs = 0)
        assertEquals(SegmentPolicy.Action.None, p.flush())
        p.onFrame(0, frame, true)
        assertEquals(SegmentPolicy.Action.Close(keep = true), p.flush())
    }
}
