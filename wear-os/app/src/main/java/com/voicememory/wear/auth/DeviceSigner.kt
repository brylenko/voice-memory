package com.voicememory.wear.auth

import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Produces the HMAC-SHA256 credentials the backend expects
 * (see DeviceAuthGuard / WsHmacAuthService on the server).
 */
class DeviceSigner(
    private val deviceId: String,
    secret: String,
    private val clock: () -> Long = { System.currentTimeMillis() / 1000 },
    private val nonces: () -> String = ::randomNonce,
) {
    private val key = SecretKeySpec(secret.toByteArray(), ALGORITHM)

    /** HTTP: X-Device-Serial / X-Device-Timestamp / X-Device-Signature = HMAC(serial.ts). */
    fun httpHeaders(): Map<String, String> {
        val ts = clock()
        return mapOf(
            "X-Device-Serial" to deviceId,
            "X-Device-Timestamp" to ts.toString(),
            "X-Device-Signature" to hmacHex("$deviceId.$ts"),
        )
    }

    /** WebSocket: deviceId, ts, nonce, sig = HMAC(deviceId.ts.nonce). Nonce is single-use. */
    fun wsQuery(): Map<String, String> {
        val ts = clock()
        val nonce = nonces()
        return mapOf(
            "deviceId" to deviceId,
            "ts" to ts.toString(),
            "nonce" to nonce,
            "sig" to hmacHex("$deviceId.$ts.$nonce"),
        )
    }

    private fun hmacHex(payload: String): String =
        Mac.getInstance(ALGORITHM).apply { init(key) }.doFinal(payload.toByteArray()).toHex()

    private companion object {
        const val ALGORITHM = "HmacSHA256"
        val random = SecureRandom()
        fun randomNonce(): String = ByteArray(16).also(random::nextBytes).toHex()
    }
}

private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
