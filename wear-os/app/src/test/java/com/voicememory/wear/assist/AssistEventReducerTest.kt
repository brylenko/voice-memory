package com.voicememory.wear.assist

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AssistEventReducerTest {
    private fun reduce(s: AssistState, json: String) = AssistEventReducer.reduce(s, JSONObject(json))

    @Test fun `streams an answer and emits a single effect when done`() {
        var s = reduce(AssistState(), """{"type":"ready","mode":"auto"}""").first
        assertEquals(ConnectionStatus.LISTENING, s.status)

        s = reduce(s, """{"type":"partial","id":"u1","text":"How far"}""").first
        assertEquals("How far", s.caption)

        s = reduce(s, """{"type":"answer.start","id":"a1","inReplyTo":"u1"}""").first
        val (s2, e1) = reduce(s, """{"type":"answer.delta","id":"a1","text":"384 000"}""")
        assertNull(e1)
        val (s3, e2) = reduce(s2, """{"type":"answer.done","id":"a1","text":"384 000 km"}""")

        assertEquals(listOf(Answer("a1", "384 000 km", true)), s3.answers)
        assertEquals(AssistEventReducer.Effect.AnswerReady("384 000 km"), e2)
    }

    @Test fun `failed answers are removed and errors surface`() {
        var s = reduce(AssistState(), """{"type":"answer.start","id":"a1","inReplyTo":"u1"}""").first
        s = reduce(s, """{"type":"answer.error","id":"a1","message":"x"}""").first
        assertTrue(s.answers.isEmpty())

        s = reduce(s, """{"type":"error","message":"quota"}""").first
        assertEquals(ConnectionStatus.ERROR, s.status)
        assertEquals("quota", s.error)
    }

    @Test fun `ai_unavailable error stops the session with a dedicated flag and effect`() {
        val (s1, e1) = reduce(AssistState(), """{"type":"error","code":"ai_unavailable","message":"no credits"}""")
        assertTrue(s1.aiUnavailable)
        assertEquals(ConnectionStatus.ERROR, s1.status)
        assertEquals(AssistEventReducer.Effect.AiUnavailable, e1)

        val started = reduce(AssistState(), """{"type":"answer.start","id":"a1","inReplyTo":"u1"}""").first
        val (s2, e2) = reduce(started, """{"type":"answer.error","id":"a1","code":"ai_unavailable","message":"x"}""")
        assertTrue(s2.aiUnavailable && s2.answers.isEmpty())
        assertEquals(AssistEventReducer.Effect.AiUnavailable, e2)
    }

    @Test fun `ordinary answer errors do not stop the session`() {
        val started = reduce(AssistState(status = ConnectionStatus.LISTENING), """{"type":"answer.start","id":"a1","inReplyTo":"u1"}""").first
        val (s, e) = reduce(started, """{"type":"answer.error","id":"a1","message":"x"}""")
        assertEquals(ConnectionStatus.LISTENING, s.status)
        assertNull(e)
    }
}
