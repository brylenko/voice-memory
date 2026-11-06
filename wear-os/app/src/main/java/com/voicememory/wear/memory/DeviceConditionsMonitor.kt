package com.voicememory.wear.memory

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.BatteryManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** Observes charger + network state (Observer pattern) for [TransportPolicy]. */
class DeviceConditionsMonitor(private val context: Context) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val _state = MutableStateFlow(DeviceConditions())
    val state: StateFlow<DeviceConditions> = _state.asStateFlow()

    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) = updateCharging(intent)
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = refreshNetwork()
        override fun onLost(network: Network) = refreshNetwork()
    }

    fun start() {
        // Sticky broadcast → returns the current battery state immediately.
        context.registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?.let(::updateCharging)
        connectivity.registerDefaultNetworkCallback(networkCallback)
        refreshNetwork()
    }

    fun stop() {
        runCatching { context.unregisterReceiver(batteryReceiver) }
        runCatching { connectivity.unregisterNetworkCallback(networkCallback) }
    }

    private fun updateCharging(intent: Intent) {
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        _state.update { it.copy(charging = charging) }
    }

    private fun refreshNetwork() {
        val caps = connectivity.activeNetwork?.let(connectivity::getNetworkCapabilities)
        val online = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        val wifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
        _state.update { it.copy(online = online, unmeteredWifi = online && wifi) }
    }
}
