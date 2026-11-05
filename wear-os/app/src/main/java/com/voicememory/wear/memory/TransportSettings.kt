package com.voicememory.wear.memory

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Persisted [TransportPreference], observable by both the UI and the recorder service. */
object TransportSettings {
    private const val PREFS = "memory_settings"
    private const val KEY = "transport_preference"

    private val _preference = MutableStateFlow(TransportPreference.AUTO)
    val preference: StateFlow<TransportPreference> = _preference.asStateFlow()

    @Volatile private var loaded = false

    fun load(context: Context) {
        if (loaded) return
        val raw = prefs(context).getString(KEY, null)
        _preference.value = TransportPreference.entries.firstOrNull { it.name == raw } ?: TransportPreference.AUTO
        loaded = true
    }

    fun set(context: Context, value: TransportPreference) {
        _preference.value = value
        prefs(context).edit().putString(KEY, value.name).apply()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
