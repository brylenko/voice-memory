package com.voicememory.wear.assist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechGateTest {
    private val loud: Short = 1000
    private fun frame(v: Short) = ShortArray(4) { v }
    private val gate = SpeechGate(isSpeech = { it[0] == loud }, preRollFrames = 2, tailFrames = 2)

    @Test fun `silence is not sent at all`() {
        repeat(50) { assertTrue(gate.accept(frame(0), muted = false).isEmpty()) }
    }

    @Test fun `speech flushes the pre-roll, then a short tail follows, then nothing`() {
        gate.accept(frame(1), false); gate.accept(frame(2), false); gate.accept(frame(3), false)
        val start = gate.accept(frame(loud), false)
        assertEquals(listOf<Short>(2, 3, loud), start.map { it[0] }) // pre-roll keeps the last 2
        assertEquals(1, gate.accept(frame(0), false).size) // tail 1
        assertEquals(1, gate.accept(frame(0), false).size) // tail 2
        assertTrue(gate.accept(frame(0), false).isEmpty())
    }

    @Test fun `muted frames (our own voice) never count as speech and are sent as silence`() {
        assertTrue(gate.accept(frame(loud), muted = true).isEmpty())
        gate.accept(frame(loud), muted = false)
        val tail = gate.accept(frame(loud), muted = true)
        assertEquals(1, tail.size)
        assertTrue(tail[0].all { it == 0.toShort() })
    }
}
