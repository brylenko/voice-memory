package com.voicememory.wear.memory

import android.content.Context
import java.io.File

/**
 * File naming contract for recorded segments:
 *   seg_<epochMs>.part           — being written (corrupt if the process died)
 *   seg_<epochMs>_<durS>s.m4a    — finished, waiting for upload
 * Encoding the duration into the name lets uploads resume after a reboot.
 */
class SegmentStore(context: Context) {
    val dir: File = File(context.filesDir, "segments").apply { mkdirs() }

    fun newPartFile(nowMs: Long): File = File(dir, "seg_$nowMs.part")

    fun complete(part: File, durationSeconds: Int): File {
        val done = File(dir, part.name.removeSuffix(".part") + "_${durationSeconds}s.m4a")
        part.renameTo(done)
        return done
    }

    fun pendingUploads(): List<File> = dir.listFiles { f -> f.name.endsWith(".m4a") }?.sortedBy { it.name }.orEmpty()

    fun deleteOrphanParts() {
        dir.listFiles { f -> f.name.endsWith(".part") }?.forEach { it.delete() }
    }

    companion object {
        private val DURATION = Regex("""_(\d+)s\.m4a$""")
        fun durationOf(file: File): Int = DURATION.find(file.name)?.groupValues?.get(1)?.toInt() ?: 1
    }
}
