package com.voicememory.wear.audio

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File

/**
 * PCM16 mono → AAC-LC in an .m4a container. ~32 kbit/s is plenty for speech
 * recognition and is ~8× smaller than WAV — matters on a watch radio.
 */
class AacFileEncoder(
    private val file: File,
    private val sampleRate: Int,
    bitRate: Int = 32_000,
) {
    private val codec: MediaCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    private val muxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    private val info = MediaCodec.BufferInfo()
    private var track = -1
    private var muxerStarted = false
    private var samplesQueued = 0L

    init {
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, 1).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024)
        }
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
    }

    val durationSeconds: Int get() = (samplesQueued / sampleRate).toInt()

    fun encode(pcm: ShortArray) {
        val bytes = pcm.toLittleEndianBytes()
        var offset = 0
        while (offset < bytes.size) {
            val index = codec.dequeueInputBuffer(TIMEOUT_US)
            if (index < 0) { drain(false); continue }
            val buffer = codec.getInputBuffer(index)!!
            buffer.clear()
            val len = minOf(buffer.remaining(), bytes.size - offset)
            buffer.put(bytes, offset, len)
            codec.queueInputBuffer(index, 0, len, presentationUs(), 0)
            samplesQueued += len / 2
            offset += len
            drain(false)
        }
    }

    /** Flushes, finalizes the container and returns the encoded file. */
    fun finish(): File {
        try {
            val index = codec.dequeueInputBuffer(TIMEOUT_US * 10)
            if (index >= 0) {
                codec.queueInputBuffer(index, 0, 0, presentationUs(), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            }
            drain(true)
        } finally {
            release()
        }
        return file
    }

    fun abort() {
        release()
        file.delete()
    }

    private fun presentationUs(): Long = samplesQueued * 1_000_000L / sampleRate

    private fun drain(endOfStream: Boolean) {
        var idleTries = 0
        while (true) {
            val index = codec.dequeueOutputBuffer(info, if (endOfStream) TIMEOUT_US else 0)
            when {
                // Bounded wait for EOS so a misbehaving codec can never hang the recorder.
                index == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!endOfStream || ++idleTries > 200) return
                index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    track = muxer.addTrack(codec.outputFormat)
                    muxer.start()
                    muxerStarted = true
                }
                index >= 0 -> {
                    val out = codec.getOutputBuffer(index)!!
                    val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                    if (!isConfig && info.size > 0 && muxerStarted) {
                        out.position(info.offset)
                        out.limit(info.offset + info.size)
                        muxer.writeSampleData(track, out, info)
                    }
                    codec.releaseOutputBuffer(index, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                }
            }
        }
    }

    private fun release() {
        runCatching { codec.stop() }
        runCatching { codec.release() }
        if (muxerStarted) runCatching { muxer.stop() }
        runCatching { muxer.release() }
    }

    private companion object {
        const val TIMEOUT_US = 10_000L
    }
}
