package com.voicememory.wear.assist

import android.content.Context
import androidx.annotation.StringRes
import com.voicememory.wear.R
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Conversation context presets; `wire` must match the backend's AssistantTopicId. */
enum class AssistTopic(val wire: String, @StringRes val label: Int) {
    NONE("none", R.string.topic_none),
    INTERVIEW_IT("interview_it", R.string.topic_interview_it),
    WORK_IT("work_it", R.string.topic_work_it),
    STUDY("study", R.string.topic_study),
    MEDICINE("medicine", R.string.topic_medicine),
    SHOPPING("shopping", R.string.topic_shopping),
}

/** Persisted, observable topic choice (shared by the picker screen and the assistant). */
object TopicSettings {
    private const val PREFS = "assistant_settings"
    private const val KEY = "topic"

    private val _topic = MutableStateFlow(AssistTopic.NONE)
    val topic: StateFlow<AssistTopic> = _topic.asStateFlow()
    @Volatile private var loaded = false

    fun load(context: Context) {
        if (loaded) return
        val raw = prefs(context).getString(KEY, null)
        _topic.value = AssistTopic.entries.firstOrNull { it.wire == raw } ?: AssistTopic.NONE
        loaded = true
    }

    fun set(context: Context, topic: AssistTopic) {
        _topic.value = topic
        prefs(context).edit().putString(KEY, topic.wire).apply()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
