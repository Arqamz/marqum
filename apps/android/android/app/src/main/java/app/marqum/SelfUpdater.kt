package app.marqum

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Keeps Marqūm up to date from its GitHub releases, with no store and no taps: every few hours (on any network)
 * it reads the latest release, and when its APK is newer than the installed version and signed with the same key,
 * installs it through PackageInstaller. Android 12+ lets an app update itself without asking once it may install
 * apps ("Install unknown apps" for Marqūm, granted once).
 */
object SelfUpdater {
    private const val TAG = "MarqumUpdate"
    private const val PERIODIC = "marqum-self-update"
    private const val NOW = "marqum-self-update-now"
    private const val LATEST = "https://api.github.com/repos/Arqamz/marqum/releases/latest"
    const val ACTION_STATUS = "app.marqum.UPDATE_STATUS"

    data class Release(val version: String, val apkUrl: String)

    fun schedule(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val periodic = PeriodicWorkRequestBuilder<UpdateWorker>(6, TimeUnit.HOURS).setConstraints(constraints).build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, periodic)
    }

    fun checkNow(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val once = OneTimeWorkRequestBuilder<UpdateWorker>().setConstraints(constraints).build()
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, once)
    }

    fun installedVersion(context: Context): String =
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0"

    /** "0.4.10" > "0.4.9"; a leading "v" is ignored. */
    fun isNewer(tag: String, current: String): Boolean {
        fun parts(v: String) = v.removePrefix("v").split('.', '-').take(3).map { it.toIntOrNull() ?: 0 }
        val a = parts(tag)
        val b = parts(current)
        for (i in 0 until 3) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    fun latest(): Release? {
        val conn = (URL(LATEST).openConnection() as HttpURLConnection).apply {
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("User-Agent", "Marqum-SelfUpdater")
            connectTimeout = 15_000
            readTimeout = 15_000
        }
        try {
            if (conn.responseCode != 200) return null
            val json = JSONObject(conn.inputStream.bufferedReader().readText())
            val tag = json.optString("tag_name").ifEmpty { return null }
            val assets = json.optJSONArray("assets") ?: return null
            for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                if (a.optString("name").endsWith(".apk")) {
                    return Release(tag.removePrefix("v"), a.getString("browser_download_url"))
                }
            }
            return null
        } finally {
            conn.disconnect()
        }
    }

    /** Checks, downloads and installs when there is something newer. Returns what it did. Call off the main thread. */
    fun run(context: Context): String {
        val current = installedVersion(context)
        val release = latest() ?: return "no release"
        if (!isNewer(release.version, current)) return "up to date ($current)"
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val apk = File(dir, "marqum-${release.version}.apk")
        download(release.apkUrl, apk)
        if (!sameSigner(context, apk)) {
            apk.delete()
            return "rejected ${release.version}: different signing key"
        }
        install(context, apk)
        return "installing ${release.version}"
    }

    private fun download(url: String, to: File) {
        var next = url
        repeat(5) {
            val conn = (URL(next).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                setRequestProperty("User-Agent", "Marqum-SelfUpdater")
                connectTimeout = 15_000
                readTimeout = 60_000
            }
            try {
                val code = conn.responseCode
                if (code in 300..399) {
                    next = conn.getHeaderField("Location") ?: throw IllegalStateException("redirect without location")
                    return@repeat
                }
                if (code != 200) throw IllegalStateException("download failed: $code")
                conn.inputStream.use { input -> to.outputStream().use { input.copyTo(it) } }
                return
            } finally {
                conn.disconnect()
            }
        }
        throw IllegalStateException("too many redirects")
    }

    private fun certDigests(signatures: Array<android.content.pm.Signature>?): Set<String> =
        signatures.orEmpty().map { sig ->
            MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it) }
        }.toSet()

    private fun sameSigner(context: Context, apk: File): Boolean {
        val pm = context.packageManager
        val flags = PackageManager.GET_SIGNING_CERTIFICATES
        val archive = pm.getPackageArchiveInfo(apk.path, flags) ?: return false
        if (archive.packageName != context.packageName) return false
        val installed = pm.getPackageInfo(context.packageName, flags)
        val a = certDigests(archive.signingInfo?.apkContentsSigners)
        val b = certDigests(installed.signingInfo?.apkContentsSigners)
        return a.isNotEmpty() && a == b
    }

    private fun install(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("base.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val intent = Intent(context, UpdateStatusReceiver::class.java).setAction(ACTION_STATUS)
            val pending = PendingIntent.getBroadcast(
                context,
                id,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(pending.intentSender)
        }
        Log.i(TAG, "committed install of ${apk.name}")
    }
}

class UpdateWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result =
        try {
            Log.i("MarqumUpdate", SelfUpdater.run(applicationContext))
            Result.success()
        } catch (e: Exception) {
            Log.w("MarqumUpdate", "update check failed", e)
            Result.retry()
        }
}

/** Install result. If Android still wants a tap (permission not granted yet), show its confirm screen. */
class UpdateStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(confirm)
            }
            PackageInstaller.STATUS_SUCCESS -> Log.i("MarqumUpdate", "updated")
            else -> Log.w(
                "MarqumUpdate",
                "install failed ($status): ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)}",
            )
        }
    }
}
