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
        return try {
            api.uploadRecording(file, SegmentStore.durationOf(file), "audio/mp4")
            file.delete()
            Result.success()
        } catch (e: ApiException) {
            Log.w(TAG, "upload ${file.name} failed: ${e.message}")
            if (e.isPermanent) {
                file.delete() // e.g. 403 quota exceeded → retrying won't help
                Result.failure()
            } else Result.retry()
        } catch (e: Exception) {
            Log.w(TAG, "upload ${file.name} failed: ${e.message}")
            Result.retry()
        }
    }

    companion object {
        private const val TAG = "SegmentUpload"
        private const val KEY_PATH = "path"

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
