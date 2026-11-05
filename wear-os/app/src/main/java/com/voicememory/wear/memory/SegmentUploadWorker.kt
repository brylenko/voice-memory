package com.voicememory.wear.memory

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.voicememory.wear.AppContainer
import com.voicememory.wear.net.ApiException
import com.voicememory.wear.net.UploadTicket
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Uploads one finished segment. WorkManager gives us persistence across
 * reboots, network constraints and exponential backoff for free — the
 * recorder never blocks on the network.
 */
class SegmentUploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val file = File(inputData.getString(KEY_PATH) ?: return Result.failure())
        if (!file.exists()) return Result.success() // already uploaded by an earlier attempt

        val api = AppContainer.get(applicationContext).api
        // Phase-1 ticket is persisted next to the file: a retry re-uses the same track
        // instead of creating a new (soon abandoned) INITIALIZED track on the server.
        val ticketFile = File(file.path + TICKET_SUFFIX)

        return try {
            val ticket = ticketFile.takeIf { it.exists() }
                ?.let { UploadTicket.fromJson(it.readText()) }
                ?.takeIf { it.isFresh() }
                ?: api.requestUpload(file.name, SegmentStore.durationOf(file)).also { ticketFile.writeText(it.toJson()) }

            try {
                api.putFile(ticket, file, "audio/mp4")
            } catch (e: ApiException) {
                // Upload URL rejected (expired presign / wrong host): next attempt asks for a fresh one.
                if (e.isPermanent) ticketFile.delete()
                throw RetryableUpload(e)
            }
            api.completeUpload(ticket.trackId)

            file.delete()
            ticketFile.delete()
            Result.success()
        } catch (e: RetryableUpload) {
            Log.w(TAG, "upload ${file.name}: PUT failed, will retry: ${e.cause?.message}")
            Result.retry()
        } catch (e: ApiException) {
            Log.w(TAG, "upload ${file.name} failed: ${e.message}")
            if (e.isPermanent) {
                file.delete() // e.g. 403 quota exceeded → retrying won't help
                ticketFile.delete()
                Result.failure()
            } else Result.retry()
        } catch (e: Exception) {
            Log.w(TAG, "upload ${file.name} failed: ${e.message}")
            Result.retry()
        }
    }

    private class RetryableUpload(cause: Throwable) : Exception(cause)

    companion object {
        private const val TAG = "SegmentUpload"
        private const val KEY_PATH = "path"
        private const val TICKET_SUFFIX = ".ticket"

        fun enqueue(context: Context, file: File) {
            val request = OneTimeWorkRequestBuilder<SegmentUploadWorker>()
                .setInputData(workDataOf(KEY_PATH to file.absolutePath))
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .setRequiresBatteryNotLow(true)
                        .build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork("upload-${file.name}", ExistingWorkPolicy.KEEP, request)
        }
    }
}
