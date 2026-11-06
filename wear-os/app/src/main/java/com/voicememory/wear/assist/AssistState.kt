package com.voicememory.wear.assist

enum class AssistMode(val wire: String) { AUTO("auto"), MANUAL("manual") }

enum class ConnectionStatus { CONNECTING, LISTENING, STOPPING, DONE, ERROR }

data class Answer(val id: String, val text: String, val done: Boolean)

data class AssistState(
    val status: ConnectionStatus = ConnectionStatus.CONNECTING,
    val mode: AssistMode = AssistMode.AUTO,
    /** Live caption of what is being said right now. */
    val caption: String = "",
    /** Newest first, capped. */
    val answers: List<Answer> = emptyList(),
    val error: String? = null,
    /** Server reported no AI credits: mic is stopped, nothing would be answered. */
    val aiUnavailable: Boolean = false,
    /** Server can speak answers itself (natural voice); otherwise the watch's own TTS is used. */
    val serverTts: Boolean = false,
)
