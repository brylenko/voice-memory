package com.voicememory.wear.assist

import org.json.JSONObject

/**
 * Pure reducer: (state, server event JSON) → new state. Keeping protocol
 * handling side-effect free makes it trivially unit-testable.
 */
object AssistEventReducer {
    private const val MAX_ANSWERS = 10
    private const val AI_UNAVAILABLE = "ai_unavailable"

    sealed interface Effect {
        data class AnswerReady(val text: String) : Effect
        data object AiUnavailable : Effect
    }

    fun reduce(state: AssistState, json: JSONObject): Pair<AssistState, Effect?> {
        return when (json.optString("type")) {
            "ready" -> state.copy(status = ConnectionStatus.LISTENING) to null
            "partial" -> state.copy(caption = json.optString("text")) to null
            "utterance" -> state.copy(caption = json.optString("text")) to null
            "answer.start" -> state.copy(
                answers = (listOf(Answer(json.getString("id"), "", false)) + state.answers).take(MAX_ANSWERS),
            ) to null
            "answer.delta" -> state.updateAnswer(json.getString("id")) {
                it.copy(text = it.text + json.optString("text"))
            } to null
            "answer.done" -> {
                val text = json.optString("text")
                state.updateAnswer(json.getString("id")) { it.copy(text = text, done = true) } to
                    Effect.AnswerReady(text)
            }
            "answer.error" -> {
                val next = state.copy(answers = state.answers.filterNot { it.id == json.optString("id") })
                if (json.optString("code") == AI_UNAVAILABLE) {
                    next.copy(status = ConnectionStatus.ERROR, aiUnavailable = true) to Effect.AiUnavailable
                } else next to null
            }
            "done" -> state.copy(status = ConnectionStatus.DONE) to null
            "error" -> {
                val ai = json.optString("code") == AI_UNAVAILABLE
                state.copy(status = ConnectionStatus.ERROR, error = json.optString("message"), aiUnavailable = ai) to
                    (if (ai) Effect.AiUnavailable else null)
            }
            else -> state to null
        }
    }

    private fun AssistState.updateAnswer(id: String, f: (Answer) -> Answer): AssistState =
        copy(answers = answers.map { if (it.id == id) f(it) else it })
}
