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

class SegmentPolicyLimitsTest {
    @Test fun `offline limits cut segments after one minute of speech`() {
        val p = SegmentPolicy()
        p.onFrame(0, 30, true)
        p.useLimits(SegmentPolicy.Limits.OFFLINE)
        var t = 0L
        var action: SegmentPolicy.Action = SegmentPolicy.Action.None
        while (t < 120_000 && action !is SegmentPolicy.Action.Close) { t += 30; action = p.onFrame(t, 30, true) }
        assertEquals(SegmentPolicy.Action.Close(keep = true), action)
        org.junit.Assert.assertTrue("closed at ${t}ms", t in 59_000..61_000)
    }

    @Test fun `offline limits close after 15 s of silence`() {
        val p = SegmentPolicy(minVoicedMs = 0)
        p.onFrame(0, 30, true)
        p.useLimits(SegmentPolicy.Limits.OFFLINE)
        assertEquals(SegmentPolicy.Action.None, p.onFrame(14_000, 30, false))
        assertEquals(SegmentPolicy.Action.Close(keep = true), p.onFrame(15_100, 30, false))
    }
}
