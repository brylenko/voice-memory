package com.voicememory.wear.auth

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings

/** Stable per-install device id; becomes the user's identity on the backend (users.deviceId). */
object DeviceIdentity {
    @SuppressLint("HardwareIds")
    fun deviceId(context: Context): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        return "wear-$androidId"
    }
}
