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
    /** Server can run speech recognition (false = no AI credits): streaming would be pointless. */
    val aiAvailable: Boolean = true,
)

/**
 * Pure rule: stream only when it is cheap — on the charger (battery is no
 * concern) or on unmetered Wi-Fi (radio is cheap) — and the network is up.
 * Evaluated once per conversation, so a conversation is never split between transports.
 */
object TransportPolicy {
    /**
     * [preference] overrides the automatic rule, with one safety exception:
     * ALWAYS_LIVE without a network still records to segments — streaming into
     * nothing would just lose the conversation.
     */
    fun choose(c: DeviceConditions, preference: TransportPreference = TransportPreference.AUTO): Transport =
        if (!c.aiAvailable) Transport.SEGMENTS // record locally, upload once AI is back
        else when (preference) {
            TransportPreference.ALWAYS_OFFLINE -> Transport.SEGMENTS
            TransportPreference.ALWAYS_LIVE -> if (c.online) Transport.LIVE else Transport.SEGMENTS
            TransportPreference.AUTO ->
                if (c.online && (c.charging || c.unmeteredWifi)) Transport.LIVE else Transport.SEGMENTS
        }
}

/** User's manual override from the watch UI. */
enum class TransportPreference {
    AUTO, ALWAYS_LIVE, ALWAYS_OFFLINE;

    fun next(): TransportPreference = entries[(ordinal + 1) % entries.size]
}
