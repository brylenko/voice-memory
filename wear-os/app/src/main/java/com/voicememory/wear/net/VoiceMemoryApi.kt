package com.voicememory.wear.net

import com.voicememory.wear.auth.DeviceSigner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.File
import java.io.IOException

class ApiException(val code: Int, message: String) : IOException(message) {
    /** 4xx (except 408/429) won't succeed on retry. */
    val isPermanent: Boolean get() = code in 400..499 && code != 408 && code != 429
}

data class DayItem(val at: String, val summary: String, val tags: List<String>, val live: Boolean)
data class DayMemory(val date: String, val digest: String?, val items: List<DayItem>)

/** Thin facade over the backend REST + WebSocket endpoints (Facade pattern). */
class VoiceMemoryApi(
    private val baseUrl: String,
    private val http: OkHttpClient,
    private val signer: DeviceSigner,
) {
    private val json = "application/json".toMediaType()

    /**
     * Two-phase direct-to-storage upload (same flow the IoT recorder uses):
     * 1) POST /audio/upload-url  2) PUT bytes to returned URL  3) POST /audio/upload-complete
     */
    suspend fun uploadRecording(file: File, durationSeconds: Int, contentType: String): String =
        withContext(Dispatchers.IO) {
            val phase1 = postJson(
                "/audio/upload-url",
                JSONObject()
                    .put("durationSeconds", durationSeconds.coerceAtLeast(1))
                    .put("fileName", file.name)
                    .put("channel", "wear-os"),
            )
            val trackId = phase1.getString("trackId")
            val uploadUrl = phase1.getString("uploadUrl")

            val put = Request.Builder()
                .url(uploadUrl)
                .put(file.asRequestBody(contentType.toMediaType()))
                .build()
            http.newCall(put).execute().use { it.ensureSuccess() }

            postJson("/audio/upload-complete", JSONObject().put("trackId", trackId))
            trackId
        }

    suspend fun getDay(tzOffsetMinutes: Int, date: String? = null): DayMemory = withContext(Dispatchers.IO) {
        val url = "$baseUrl/api/memory/day".toHttpUrl().newBuilder()
            .addQueryParameter("tzOffsetMinutes", tzOffsetMinutes.toString())
            .apply { if (date != null) addQueryParameter("date", date) }
            .build()
        val req = Request.Builder().url(url).signed().get().build()
        val body = http.newCall(req).execute().use { it.ensureSuccess(); it.body!!.string() }
        val obj = JSONObject(body)
        val items = obj.getJSONArray("items")
        DayMemory(
            date = obj.getString("date"),
            digest = obj.optString("digest").takeIf { it.isNotBlank() && it != "null" },
            items = List(items.length()) { i ->
                val it = items.getJSONObject(i)
                val tags = it.optJSONArray("tags")
                DayItem(
                    at = it.getString("at"),
                    summary = it.getString("summary"),
                    tags = List(tags?.length() ?: 0) { t -> tags!!.getString(t) },
                    live = it.optBoolean("live", false),
                )
            },
        )
    }

    /** Opens /assist/live with fresh single-use HMAC credentials. */
    fun openAssistant(
        mode: String,
        save: Boolean,
        language: String?,
        listener: WebSocketListener,
    ): WebSocket {
        val url = "$baseUrl/assist/live".toHttpUrl().newBuilder().apply {
            signer.wsQuery().forEach { (k, v) -> addQueryParameter(k, v) }
            addQueryParameter("mode", mode)
            if (save) addQueryParameter("save", "1")
            if (language != null) addQueryParameter("lang", language)
        }.build()
        // OkHttp accepts http(s) URLs for WebSockets and upgrades them itself.
        return http.newWebSocket(Request.Builder().url(url).build(), listener)
    }

    /** Opens /audio/live for memory mode: utterance-level persistence while talking. */
    fun openLiveTranscription(language: String?, listener: WebSocketListener): WebSocket {
        val url = "$baseUrl/audio/live".toHttpUrl().newBuilder().apply {
            signer.wsQuery().forEach { (k, v) -> addQueryParameter(k, v) }
            addQueryParameter("channel", "wear-live")
            addQueryParameter("vad", "1")
            if (language != null) addQueryParameter("lang", language)
        }.build()
        return http.newWebSocket(Request.Builder().url(url).build(), listener)
    }

    private fun postJson(path: String, body: JSONObject): JSONObject {
        val req = Request.Builder()
            .url(baseUrl + path)
            .signed()
            .post(body.toString().toRequestBody(json))
            .build()
        return http.newCall(req).execute().use {
            it.ensureSuccess()
            JSONObject(it.body?.string().orEmpty().ifBlank { "{}" })
        }
    }

    private fun Request.Builder.signed(): Request.Builder = apply {
        signer.httpHeaders().forEach { (k, v) -> header(k, v) }
    }

    private fun Response.ensureSuccess() {
        if (!isSuccessful) throw ApiException(code, "HTTP $code ${request.url.encodedPath}: ${body?.string()?.take(200)}")
    }
}
