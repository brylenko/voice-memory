package com.voicememory.wear.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadTicketTest {
    private val ticket = UploadTicket("track-1", "https://host/audio/local-upload/u/f.m4a", expiresAtMs = 1_000_000)

    @Test fun `round-trips through JSON`() = assertEquals(ticket, UploadTicket.fromJson(ticket.toJson()))

    @Test fun `corrupt ticket file is ignored`() = assertNull(UploadTicket.fromJson("{not json"))

    @Test fun `is stale one minute before expiry`() {
        assertTrue(ticket.isFresh(nowMs = 1_000_000 - 61_000))
        assertFalse(ticket.isFresh(nowMs = 1_000_000 - 59_000))
    }
}
