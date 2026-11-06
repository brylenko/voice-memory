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

class TransportPreferenceTest {
    private val batteryLte = DeviceConditions(charging = false, unmeteredWifi = false, online = true)
    private val charging = DeviceConditions(charging = true, unmeteredWifi = false, online = true)
    private val offline = DeviceConditions(charging = true, unmeteredWifi = true, online = false)

    @Test fun `always live overrides the battery rule`() =
        assertEquals(Transport.LIVE, TransportPolicy.choose(batteryLte, TransportPreference.ALWAYS_LIVE))

    @Test fun `always live still falls back to segments without a network`() =
        assertEquals(Transport.SEGMENTS, TransportPolicy.choose(offline, TransportPreference.ALWAYS_LIVE))

    @Test fun `always offline overrides the charger`() =
        assertEquals(Transport.SEGMENTS, TransportPolicy.choose(charging, TransportPreference.ALWAYS_OFFLINE))

    @Test fun `next cycles through all options`() {
        assertEquals(TransportPreference.ALWAYS_LIVE, TransportPreference.AUTO.next())
        assertEquals(TransportPreference.ALWAYS_OFFLINE, TransportPreference.ALWAYS_LIVE.next())
        assertEquals(TransportPreference.AUTO, TransportPreference.ALWAYS_OFFLINE.next())
    }
}

class TransportPolicyAiTest {
    @Test fun `no AI on the server means local segments even when streaming is preferred`() =
        assertEquals(
            Transport.SEGMENTS,
            TransportPolicy.choose(
                DeviceConditions(charging = true, unmeteredWifi = true, online = true, aiAvailable = false),
                TransportPreference.ALWAYS_LIVE,
            ),
        )
}
