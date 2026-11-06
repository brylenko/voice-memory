package com.voicememory.wear.net

import org.junit.Assert.assertEquals
import org.junit.Test

class UploadUrlsTest {
    private val base = "https://mighty-internally-haddock.ngrok-free.app"

    @Test fun `misconfigured local upload host is replaced by the device's base URL`() = assertEquals(
        "$base/audio/local-upload/user-1/abc.m4a",
        UploadUrls.forDevice("http://localhost:3000/audio/local-upload/user-1/abc.m4a", base),
    )

    @Test fun `correct local upload URL is kept`() {
        val url = "$base/audio/local-upload/user-1/abc.m4a"
        assertEquals(url, UploadUrls.forDevice(url, base))
    }

    @Test fun `S3 presigned URLs are never touched`() {
        val s3 = "https://bucket.s3.eu-central-1.amazonaws.com/recordings/u/abc.m4a?X-Amz-Signature=xyz"
        assertEquals(s3, UploadUrls.forDevice(s3, base))
    }

    @Test fun `base URL with a path prefix is respected`() = assertEquals(
        "https://example.com/api/audio/local-upload/u/f.m4a",
        UploadUrls.forDevice("http://localhost:3000/audio/local-upload/u/f.m4a", "https://example.com/api/"),
    )
}
