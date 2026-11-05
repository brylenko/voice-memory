package com.voicememory.wear.auth

import org.junit.Assert.assertEquals
import org.junit.Test

/** Vectors computed with Node's crypto.createHmac — guarantees parity with the backend guards. */
class DeviceSignerTest {
    private val signer = DeviceSigner(
        deviceId = "wear-abc",
        secret = "secret",
        clock = { 1_700_000_000L },
        nonces = { "00112233445566778899aabbccddeeff" },
    )

    @Test fun `http headers match DeviceAuthGuard scheme`() {
        val h = signer.httpHeaders()
        assertEquals("wear-abc", h["X-Device-Serial"])
        assertEquals("1700000000", h["X-Device-Timestamp"])
        assertEquals("ad4059367311730c8de8c7e78d01e9bfaeb60d6c5b798bae26b869eaaa82aa1b", h["X-Device-Signature"])
    }

    @Test fun `ws query matches WsHmacAuthService scheme`() {
        val q = signer.wsQuery()
        assertEquals("00112233445566778899aabbccddeeff", q["nonce"])
        assertEquals("bd346771a4481716966ed15f763ff97beea7c45eae9dcb8de63d4d7d7841e955", q["sig"])
    }
}
