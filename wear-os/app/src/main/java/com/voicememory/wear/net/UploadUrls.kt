package com.voicememory.wear.net

import java.net.URI

/**
 * In local-storage mode the backend builds upload URLs from its PUBLIC_BASE_URL
 * setting. If that is misconfigured (e.g. still `http://localhost:3000`), the watch
 * would PUT into nowhere and every recording is lost on the server side.
 *
 * The watch already knows how it reaches the backend (its base URL), so for the
 * backend's own `/audio/local-upload/` endpoint it uses that origin. Any other URL
 * (S3 presigned URLs, other hosts) is returned untouched.
 */
object UploadUrls {
    private const val LOCAL_UPLOAD_PATH = "/audio/local-upload/"

    fun forDevice(uploadUrl: String, baseUrl: String): String {
        val upload = runCatching { URI(uploadUrl) }.getOrNull() ?: return uploadUrl
        val base = runCatching { URI(baseUrl) }.getOrNull() ?: return uploadUrl
        if (upload.rawPath?.startsWith(LOCAL_UPLOAD_PATH) != true) return uploadUrl
        if (upload.scheme == base.scheme && upload.host == base.host && upload.port == base.port) return uploadUrl
        val basePath = base.rawPath.orEmpty().trimEnd('/')
        return URI(base.scheme, null, base.host, base.port, null, null, null).toString() +
            basePath + upload.rawPath + (upload.rawQuery?.let { "?$it" } ?: "")
    }
}
