package com.voicememory.wear.memory

/** How a captured conversation reaches the backend. */
enum class Transport {
    /** Stream to WS /audio/live: transcript is saved utterance by utterance, in real time. */
    LIVE,
    /** Encode to AAC on the watch, upload when possible: cheapest, works offline. */
    SEGMENTS,
}

data class DeviceConditions(
    val charging: Boolean = false,
    /** Validated Wi-Fi that is not metered (no LTE / phone-proxy data). */
    val unmeteredWifi: Boolean = false,
    val online: Boolean = false,
)

/**
 * Pure rule: stream only when it is cheap — on the charger (battery is no
 * concern) or on unmetered Wi-Fi (radio is cheap) — and the network is up.
 * Evaluated once per conversation, so a conversation is never split between transports.
 */
object TransportPolicy {
    fun choose(c: DeviceConditions): Transport =
        if (c.online && (c.charging || c.unmeteredWifi)) Transport.LIVE else Transport.SEGMENTS
}
