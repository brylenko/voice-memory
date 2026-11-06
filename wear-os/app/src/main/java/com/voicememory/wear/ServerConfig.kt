package com.voicememory.wear

import android.content.Context
import android.content.Intent

/**
 * Backend address + HMAC secret. Defaults come from BuildConfig (local.properties /
 * CI env). Debug builds can override them at runtime over adb, so one APK works
 * against any test backend without rebuilding:
 *
 *   adb shell am start -S -n com.voicememory.wear/.ui.MainActivity \
 *       --es baseUrl http://localhost:3000 --es hmacSecret my-secret
 */
data class ServerConfig(val baseUrl: String, val hmacSecret: String) {
    companion object {
        private const val PREFS = "server_config"
        private const val KEY_URL = "baseUrl"
        private const val KEY_SECRET = "hmacSecret"

        fun load(context: Context): ServerConfig {
            val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val overrides = BuildConfig.DEBUG
            return ServerConfig(
                baseUrl = (if (overrides) p.getString(KEY_URL, null) else null) ?: BuildConfig.BASE_URL,
                hmacSecret = (if (overrides) p.getString(KEY_SECRET, null) else null) ?: BuildConfig.HMAC_SECRET,
            )
        }

        /** Persists overrides passed as intent extras. Returns true if anything changed. Debug only. */
        fun applyOverrides(context: Context, intent: Intent?): Boolean {
            if (!BuildConfig.DEBUG || intent == null) return false
            val url = intent.getStringExtra(KEY_URL)?.trim()?.trimEnd('/')
            val secret = intent.getStringExtra(KEY_SECRET)
            if (url.isNullOrEmpty() && secret.isNullOrEmpty()) return false
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply {
                if (!url.isNullOrEmpty()) putString(KEY_URL, url)
                if (!secret.isNullOrEmpty()) putString(KEY_SECRET, secret)
            }.commit()
            return true
        }
    }
}
