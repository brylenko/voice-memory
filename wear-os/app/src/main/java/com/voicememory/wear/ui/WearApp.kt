package com.voicememory.wear.ui

import android.annotation.SuppressLint
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Switch
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.ToggleChip
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import com.voicememory.wear.R
import com.voicememory.wear.assist.AssistMode
import com.voicememory.wear.assist.ConnectionStatus
import com.voicememory.wear.memory.MemoryRecorderService
import com.voicememory.wear.memory.MemoryStatus

private object Routes {
    const val HOME = "home"
    const val ASSIST = "assist"
    const val TODAY = "today"
}

@Composable
fun WearApp(
    micGranted: Boolean,
    requestMic: () -> Unit,
    keepScreenOn: (Boolean) -> Unit,
) {
    MaterialTheme {
        val nav = rememberSwipeDismissableNavController()
        SwipeDismissableNavHost(navController = nav, startDestination = Routes.HOME) {
            composable(Routes.HOME) {
                HomeScreen(
                    micGranted = micGranted,
                    requestMic = requestMic,
                    openAssist = { nav.navigate(Routes.ASSIST) },
                    openToday = { nav.navigate(Routes.TODAY) },
                )
            }
            composable(Routes.ASSIST) {
                AssistScreen(micGranted, requestMic, keepScreenOn, onFinished = { nav.popBackStack() })
            }
            composable(Routes.TODAY) { TodayScreen() }
        }
    }
}

/** Shared screen chrome: time on top, rotary-scrollable list with position indicator. */
@Composable
private fun WatchList(content: ScalingLazyListScope.() -> Unit) {
    val listState = rememberScalingLazyListState()
    Scaffold(
        timeText = { TimeText() },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) },
    ) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            content = content,
        )
    }
}

@Composable
private fun HomeScreen(
    micGranted: Boolean,
    requestMic: () -> Unit,
    openAssist: () -> Unit,
    openToday: () -> Unit,
) {
    val context = LocalContext.current
    val memory by MemoryStatus.state.collectAsStateWithLifecycle()

    WatchList {
        item {
            ToggleChip(
                modifier = Modifier.fillMaxWidth(),
                checked = memory.running,
                onCheckedChange = { on ->
                    when {
                        !micGranted -> requestMic()
                        on -> MemoryRecorderService.start(context)
                        else -> context.startService(
                            MemoryRecorderService.command(context, MemoryRecorderService.ACTION_STOP),
                        )
                    }
                },
                label = { Text(stringResource(R.string.memory_mode)) },
                secondaryLabel = {
                    Text(
                        when {
                            memory.error != null -> memory.error!!
                            memory.running && memory.capturingSpeech -> "● " + stringResource(R.string.memory_on)
                            memory.running -> stringResource(R.string.memory_on) + " · ${memory.segmentsSaved}"
                            else -> stringResource(R.string.memory_off)
                        },
                    )
                },
                toggleControl = { Switch(checked = memory.running) },
            )
        }
        item {
            Chip(
                modifier = Modifier.fillMaxWidth(),
                onClick = { if (micGranted) openAssist() else requestMic() },
                label = { Text(stringResource(R.string.assist_mode)) },
                secondaryLabel = { Text(stringResource(R.string.assist_hint)) },
                colors = ChipDefaults.primaryChipColors(),
            )
        }
        item {
            Chip(
                modifier = Modifier.fillMaxWidth(),
                onClick = openToday,
                label = { Text(stringResource(R.string.today)) },
                secondaryLabel = { Text(stringResource(R.string.today_hint)) },
                colors = ChipDefaults.secondaryChipColors(),
            )
        }
    }
}

@SuppressLint("MissingPermission") // guarded by micGranted
@Composable
private fun AssistScreen(
    micGranted: Boolean,
    requestMic: () -> Unit,
    keepScreenOn: (Boolean) -> Unit,
    onFinished: () -> Unit,
    vm: AssistViewModel = viewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val speak by vm.speak.collectAsStateWithLifecycle()

    LaunchedEffect(micGranted) { if (micGranted) vm.start() else requestMic() }
    DisposableEffect(Unit) {
        keepScreenOn(true)
        onDispose { keepScreenOn(false) }
    }
    LaunchedEffect(state.status) { if (state.status == ConnectionStatus.DONE) onFinished() }

    WatchList {
        item {
            Text(
                text = when (state.status) {
                    ConnectionStatus.CONNECTING -> stringResource(R.string.connecting)
                    ConnectionStatus.ERROR -> stringResource(R.string.error_prefix, state.error ?: "?")
                    else -> state.caption.ifBlank { stringResource(R.string.listening) }
                },
                style = MaterialTheme.typography.caption2,
                color = MaterialTheme.colors.onSurfaceVariant,
                textAlign = TextAlign.Center,
                maxLines = 3,
                modifier = Modifier.padding(horizontal = 12.dp),
            )
        }
        answers(state.answers.map { it.text to it.done })
        item {
            Chip(
                modifier = Modifier.fillMaxWidth(),
                onClick = vm::ask,
                enabled = state.status == ConnectionStatus.LISTENING,
                label = { Text(stringResource(R.string.ask)) },
                colors = ChipDefaults.primaryChipColors(),
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                CompactChip(
                    onClick = vm::toggleMode,
                    label = {
                        Text(stringResource(if (state.mode == AssistMode.AUTO) R.string.auto else R.string.manual))
                    },
                )
                CompactChip(
                    onClick = vm::toggleSpeak,
                    label = { Text((if (speak) "🔊 " else "🔇 ") + stringResource(R.string.speak)) },
                )
            }
        }
        item {
            CompactChip(
                onClick = { if (state.status == ConnectionStatus.ERROR) onFinished() else vm.stop() },
                label = { Text(stringResource(R.string.stop)) },
                colors = ChipDefaults.secondaryChipColors(),
            )
        }
    }
}

private fun ScalingLazyListScope.answers(answers: List<Pair<String, Boolean>>) {
    items(answers) { (text, done) ->
        Text(
            text = text.ifBlank { "…" },
            style = MaterialTheme.typography.body1,
            fontWeight = if (done) FontWeight.Normal else FontWeight.Medium,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
    }
}

@Composable
private fun TodayScreen(vm: TodayViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()

    WatchList {
        item { Text(stringResource(R.string.today), style = MaterialTheme.typography.title3) }
        when (val s = state) {
            TodayState.Loading -> item { Text(stringResource(R.string.loading)) }
            is TodayState.Failed -> item {
                Chip(
                    onClick = vm::refresh,
                    label = { Text(stringResource(R.string.error_prefix, s.message), maxLines = 3) },
                    colors = ChipDefaults.secondaryChipColors(),
                )
            }
            is TodayState.Loaded -> {
                val day = s.day
                if (day.items.isEmpty()) {
                    item { Text(stringResource(R.string.nothing_today), textAlign = TextAlign.Center) }
                }
                day.digest?.let { digest ->
                    item {
                        Text(digest, style = MaterialTheme.typography.body2, modifier = Modifier.padding(horizontal = 8.dp))
                    }
                }
                items(day.items.reversed()) { item ->
                    Chip(
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {},
                        label = { Text(item.summary, maxLines = 3) },
                        secondaryLabel = { Text(localTime(item.at)) },
                        colors = ChipDefaults.secondaryChipColors(),
                    )
                }
            }
        }
    }
}

private fun localTime(iso: String): String = runCatching {
    java.time.Instant.parse(iso)
        .atZone(java.time.ZoneId.systemDefault())
        .toLocalTime()
        .withSecond(0).withNano(0)
        .toString()
}.getOrDefault(iso)
