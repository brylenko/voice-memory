package com.voicememory.wear.memory

import org.junit.Assert.assertEquals
import org.junit.Test

class TransportPolicyTest {
    private fun choose(charging: Boolean = false, wifi: Boolean = false, online: Boolean = true) =
        TransportPolicy.choose(DeviceConditions(charging = charging, unmeteredWifi = wifi, online = online))

    @Test fun `streams live on the charger`() = assertEquals(Transport.LIVE, choose(charging = true))

    @Test fun `streams live on unmetered wifi`() = assertEquals(Transport.LIVE, choose(wifi = true))

    @Test fun `uses segments on battery over LTE or phone proxy`() = assertEquals(Transport.SEGMENTS, choose())

    @Test fun `uses segments when offline even on the charger`() =
        assertEquals(Transport.SEGMENTS, choose(charging = true, online = false))
}
