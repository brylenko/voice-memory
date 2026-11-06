package com.voicememory.wear.ui

import android.annotation.SuppressLint
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.foundation.lazy.itemsIndexed
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Card
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.ToggleButton
import androidx.wear.compose.material.ToggleButtonDefaults
import com.voicememory.wear.R
import com.voicememory.wear.assist.Answer
import com.voicememory.wear.assist.AssistMode
import com.voicememory.wear.assist.AssistState
import com.voicememory.wear.assist.ConnectionStatus

/**
 * Answer-first layout for a round screen:
 *   status line (what is heard right now · mode)
 *   latest answer, large  ← the reason this screen exists
 *   older answers, small
 *   [⚡ auto]  [✨ Answer]  [🔊 speak]
 *   Stop  (swipe-to-dismiss also stops)
 */
@SuppressLint("MissingPermission") // guarded by micGranted
@Composable
internal fun AssistScreen(
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
        item { StatusLine(state) }

        if (state.answers.isEmpty()) {
            item {
                Text(
                    text = stringResource(
                        if (state.mode == AssistMode.AUTO) R.string.assist_empty_auto else R.string.assist_empty_manual,
                    ),
                    style = MaterialTheme.typography.body2,
                    color = MaterialTheme.colors.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
        } else {
            itemsIndexed(state.answers, key = { _, a -> a.id }) { index, answer ->
                AnswerCard(answer, latest = index == 0)
            }
        }

        item {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ToggleButton(
                    checked = state.mode == AssistMode.AUTO,
                    onCheckedChange = { vm.toggleMode() },
                    modifier = Modifier.size(ToggleButtonDefaults.SmallToggleButtonSize),
                ) {
                    Icon(painterResource(R.drawable.ic_auto), contentDescription = stringResource(R.string.auto))
                }
                Button(
                    onClick = vm::ask,
                    enabled = state.status == ConnectionStatus.LISTENING,
                    modifier = Modifier.size(ButtonDefaults.LargeButtonSize),
                ) {
                    Icon(
                        painterResource(R.drawable.ic_answer),
                        contentDescription = stringResource(R.string.ask),
                        modifier = Modifier.size(ButtonDefaults.LargeIconSize),
                    )
                }
                ToggleButton(
                    checked = speak,
                    onCheckedChange = { vm.toggleSpeak() },
                    modifier = Modifier.size(ToggleButtonDefaults.SmallToggleButtonSize),
                ) {
                    Icon(
                        painterResource(if (speak) R.drawable.ic_volume_on else R.drawable.ic_volume_off),
                        contentDescription = stringResource(R.string.speak),
                    )
                }
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

@Composable
private fun StatusLine(state: AssistState) {
    val mode = stringResource(if (state.mode == AssistMode.AUTO) R.string.auto else R.string.manual)
    val text = when (state.status) {
        ConnectionStatus.CONNECTING -> stringResource(R.string.connecting)
        ConnectionStatus.ERROR -> stringResource(R.string.error_prefix, state.error ?: "?")
        else -> state.caption.ifBlank { stringResource(R.string.listening) } + " · " + mode
    }
    Text(
        text = text,
        style = MaterialTheme.typography.caption3,
        color = if (state.status == ConnectionStatus.ERROR) MaterialTheme.colors.error else MaterialTheme.colors.onSurfaceVariant,
        textAlign = TextAlign.Center,
        maxLines = 2,
        modifier = Modifier.padding(horizontal = 24.dp),
    )
}

@Composable
private fun AnswerCard(answer: Answer, latest: Boolean) {
    Card(onClick = {}, modifier = Modifier.fillMaxWidth()) {
        Text(
            text = answer.text.ifBlank { "…" },
            style = if (latest) MaterialTheme.typography.title3 else MaterialTheme.typography.body2,
            color = if (latest) MaterialTheme.colors.onSurface else MaterialTheme.colors.onSurfaceVariant,
        )
    }
}
