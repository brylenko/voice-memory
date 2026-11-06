package com.voicememory.wear.ui

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import android.content.Intent
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager
import com.voicememory.wear.ServerConfig

class MainActivity : ComponentActivity() {

    private val micGranted = mutableStateOf(false)

    /** Incremented each time we're launched via the quick action → UI jumps to the assistant. */
    private val assistRequests = mutableIntStateOf(0)

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            micGranted.value = result[Manifest.permission.RECORD_AUDIO] == true
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Must run before AppContainer is first created (use `am start -S` to restart the process).
        ServerConfig.applyOverrides(this, intent)
        micGranted.value = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        handleLaunch(intent)

        setContent {
            WearApp(
                micGranted = micGranted.value,
                requestMic = ::requestPermissions,
                keepScreenOn = ::keepScreenOn,
                assistRequests = assistRequests.intValue,
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLaunch(intent)
    }

    private fun handleLaunch(intent: Intent?) {
        if (intent != null && isQuickAssist(intent)) assistRequests.intValue++
    }

    private fun requestPermissions() {
        val perms = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        permissionLauncher.launch(perms.toTypedArray())
    }

    private fun isQuickAssist(intent: Intent): Boolean =
        intent.action == Intent.ACTION_ASSIST ||
            intent.action == Intent.ACTION_VOICE_COMMAND ||
            intent.component?.className?.endsWith(".QuickAssist") == true ||
            intent.getStringExtra(EXTRA_OPEN) == OPEN_ASSIST

    /** Assistant screen keeps the display on so answers stay visible. */
    private fun keepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    companion object {
        /** `adb shell am start -n com.voicememory.wear/.ui.MainActivity --es open assist` */
        const val EXTRA_OPEN = "open"
        const val OPEN_ASSIST = "assist"
    }
}
