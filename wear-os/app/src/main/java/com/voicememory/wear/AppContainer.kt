package com.voicememory.wear

import android.content.Context
import com.voicememory.wear.auth.DeviceIdentity
import com.voicememory.wear.auth.DeviceSigner
import com.voicememory.wear.net.VoiceMemoryApi
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Manual DI / composition root. One OkHttpClient (shared connection pool),
 * one signer, one API facade for the whole process.
 */
class AppContainer private constructor(context: Context) {
    val config: ServerConfig = ServerConfig.load(context)
    val deviceId: String = DeviceIdentity.deviceId(context)
    val signer = DeviceSigner(deviceId, config.hmacSecret)
    val language: String? = BuildConfig.LANGUAGE.ifBlank { null }

    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS) // keeps the assistant WebSocket alive through NATs
        .build()

    val api = VoiceMemoryApi(config.baseUrl.trimEnd('/'), http, signer)

    companion object {
        @Volatile private var instance: AppContainer? = null

        fun get(context: Context): AppContainer =
            instance ?: synchronized(this) {
                instance ?: AppContainer(context.applicationContext).also { instance = it }
            }
    }
}
