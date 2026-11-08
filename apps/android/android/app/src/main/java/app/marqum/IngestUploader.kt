package app.marqum

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/** Sends queued notifications to `${apiBase}/api/ingest/notification`. */
object IngestUploader {
    private const val WORK_NAME = "marqum-ingest"
    private const val PATH = "/api/ingest/notification"

    enum class Outcome { DONE, RETRY, NOT_CONFIGURED, UNAUTHORIZED }

    data class Result(val outcome: Outcome, val sent: Int, val pending: Int)

    /** Schedules a background upload (network required, exponential backoff). Safe to call often. */
    fun schedule(context: Context) {
        val request =
            OneTimeWorkRequestBuilder<IngestWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
        WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    /** Uploads everything pending, synchronously. Call off the main thread. */
    fun uploadPending(context: Context): Result {
        val config = IngestConfig.load(context)
            ?: return Result(Outcome.NOT_CONFIGURED, 0, NotificationLog.pendingCount(context))
        var sent = 0
        var outcome = Outcome.DONE
        for (n in NotificationLog.pending(context)) {
            val code = try {
                post(config, n)
            } catch (_: IOException) {
                outcome = Outcome.RETRY
                break
            }
            when {
                code in 200..299 || code == 409 -> {
                    NotificationLog.mark(context, n.id, sent = true, rejected = false)
                    sent++
                }
                code == 401 || code == 403 -> {
                    outcome = Outcome.UNAUTHORIZED // wait for configureIngest with a fresh token
                    break
                }
                code == 408 || code == 429 || code >= 500 -> {
                    outcome = Outcome.RETRY
                    break
                }
                else -> NotificationLog.mark(context, n.id, sent = false, rejected = true)
            }
        }
        return Result(outcome, sent, NotificationLog.pendingCount(context))
    }

    private fun post(config: IngestConfig.Config, n: CapturedNotification): Int {
        val conn = URL(config.apiBase + PATH).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("Authorization", "Bearer ${config.token}")
            conn.outputStream.use { it.write(n.toIngestJson().toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            runCatching { (if (code >= 400) conn.errorStream else conn.inputStream)?.use { it.readBytes() } }
            return code
        } finally {
            conn.disconnect()
        }
    }
}

class IngestWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result =
        when (IngestUploader.uploadPending(applicationContext).outcome) {
            IngestUploader.Outcome.RETRY -> Result.retry()
            else -> Result.success()
        }
}
