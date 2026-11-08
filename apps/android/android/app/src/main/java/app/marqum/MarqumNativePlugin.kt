package app.marqum

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.pm.PackageInfoCompat
import androidx.core.net.toUri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.lang.ref.WeakReference
import java.util.concurrent.Executors

/** JS contract: apps/web/src/native/marqum-native.ts */
@CapacitorPlugin(
    name = "MarqumNative",
    permissions = [Permission(alias = "storage", strings = [Manifest.permission.READ_EXTERNAL_STORAGE])],
)
class MarqumNativePlugin : Plugin() {
    private val io = Executors.newSingleThreadExecutor()

    override fun load() {
        instance = WeakReference(this)
        // The intent that launched the app (share / open-with while it wasn't running): queue for getPendingShares.
        val launch = activity?.intent
        io.execute { ShareInbox.enqueue(ShareInbox.extract(context, launch)) }
    }

    override fun handleOnNewIntent(intent: Intent?) {
        super.handleOnNewIntent(intent)
        io.execute {
            val files = ShareInbox.extract(context, intent)
            if (files.isEmpty()) return@execute
            if (hasListeners(EVENT_SHARE)) {
                notifyListeners(EVENT_SHARE, JSObject().put("files", JSArray(files)))
            } else {
                ShareInbox.enqueue(files)
            }
        }
    }

    private fun deliverCaptured(n: CapturedNotification) {
        notifyListeners(EVENT_CAPTURED, n.toJs())
    }

    override fun handleOnDestroy() {
        if (instance?.get() === this) instance = null
        super.handleOnDestroy()
    }

    // ── Statement inbox ────────────────────────────────────────────────────────────────

    private fun hasFileAccess(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            getPermissionState("storage") == PermissionState.GRANTED
        }

    @PluginMethod
    fun checkFileAccess(call: PluginCall) {
        call.resolve(JSObject().put("granted", hasFileAccess()))
    }

    @PluginMethod
    fun requestFileAccess(call: PluginCall) {
        if (hasFileAccess()) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            requestPermissionForAlias("storage", call, "storagePermissionResult")
            return
        }
        val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, "package:${context.packageName}".toUri())
        try {
            startActivityForResult(call, intent, "fileAccessResult")
        } catch (_: ActivityNotFoundException) {
            startActivityForResult(call, Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION), "fileAccessResult")
        }
    }

    @ActivityCallback
    private fun fileAccessResult(call: PluginCall?, @Suppress("UNUSED_PARAMETER") result: ActivityResult?) {
        call?.resolve(JSObject().put("granted", hasFileAccess()))
    }

    @PermissionCallback
    private fun storagePermissionResult(call: PluginCall?) {
        call?.resolve(JSObject().put("granted", hasFileAccess()))
    }

    @PluginMethod
    fun scanStatements(call: PluginCall) {
        if (!hasFileAccess()) {
            call.reject("All files access not granted", "NO_FILE_ACCESS")
            return
        }
        // JSON numbers arrive as Integer, Long or Double depending on magnitude.
        val since = (call.data.opt("since") as? Number)?.toLong() ?: 0L
        io.execute {
            try {
                val files = JSArray()
                StatementInbox.scan(since).forEach { f ->
                    files.put(
                        JSObject()
                            .put("path", f.absolutePath)
                            .put("name", f.name)
                            .put("size", f.length())
                            .put("modified", f.lastModified()),
                    )
                }
                call.resolve(JSObject().put("files", files))
            } catch (e: Exception) {
                call.reject("Scan failed", e)
            }
        }
    }

    @PluginMethod
    fun readFile(call: PluginCall) {
        val path = call.getString("path")
        if (path.isNullOrEmpty()) {
            call.reject("path is required")
            return
        }
        io.execute {
            try {
                val bytes = StatementInbox.read(path)
                call.resolve(JSObject().put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)))
            } catch (e: Exception) {
                call.reject(e.message ?: "Could not read file", e)
            }
        }
    }

    // ── Share target ───────────────────────────────────────────────────────────────────

    @PluginMethod
    fun getPendingShares(call: PluginCall) {
        // Runs on the same executor as extraction, so a launch share still being copied is included.
        io.execute { call.resolve(JSObject().put("files", JSArray(ShareInbox.drain()))) }
    }

    // ── Notification capture ───────────────────────────────────────────────────────────

    private fun hasNotificationAccess(): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

    @PluginMethod
    fun checkNotificationAccess(call: PluginCall) {
        call.resolve(JSObject().put("granted", hasNotificationAccess()))
    }

    @PluginMethod
    fun requestNotificationAccess(call: PluginCall) {
        val component = ComponentName(context, BankNotificationListener::class.java)
        val detail =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                    .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component.flattenToString())
            } else {
                null
            }
        try {
            startActivityForResult(call, detail ?: Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS), "notificationAccessResult")
        } catch (_: ActivityNotFoundException) {
            startActivityForResult(call, Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS), "notificationAccessResult")
        }
    }

    @ActivityCallback
    private fun notificationAccessResult(call: PluginCall?, @Suppress("UNUSED_PARAMETER") result: ActivityResult?) {
        call?.resolve()
    }

    @PluginMethod
    fun configureIngest(call: PluginCall) {
        val apiBase = call.getString("apiBase")
        val token = call.getString("token")
        if (apiBase.isNullOrBlank() || token.isNullOrBlank()) {
            call.reject("apiBase and token are required")
            return
        }
        if (!apiBase.startsWith("https://") && !apiBase.startsWith("http://localhost") && !apiBase.startsWith("http://10.0.2.2")) {
            call.reject("apiBase must be https")
            return
        }
        io.execute {
            try {
                IngestConfig.save(context, apiBase, token)
                IngestUploader.schedule(context)
                call.resolve()
            } catch (e: Exception) {
                call.reject("Could not store ingest settings", e)
            }
        }
    }

    @PluginMethod
    fun flushIngestQueue(call: PluginCall) {
        io.execute {
            val r = IngestUploader.uploadPending(context)
            if (r.outcome == IngestUploader.Outcome.RETRY) IngestUploader.schedule(context)
            call.resolve(JSObject().put("sent", r.sent).put("pending", r.pending))
        }
    }

    @PluginMethod
    fun getCapturedNotifications(call: PluginCall) {
        val limit = (call.data.opt("limit") as? Number)?.toInt() ?: 50
        io.execute {
            val items = JSArray()
            NotificationLog.recent(context, limit).forEach { items.put(it.toJs()) }
            call.resolve(JSObject().put("items", items))
        }
    }

    // ── App info ───────────────────────────────────────────────────────────────────────

    @PluginMethod
    fun getAppInfo(call: PluginCall) {
        try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            call.resolve(
                JSObject()
                    .put("versionName", info.versionName ?: "")
                    .put("versionCode", PackageInfoCompat.getLongVersionCode(info)),
            )
        } catch (e: Exception) {
            call.reject("Could not read package info", e)
        }
    }

    companion object {
        private const val EVENT_SHARE = "shareReceived"
        private const val EVENT_CAPTURED = "notificationCaptured"

        @Volatile private var instance: WeakReference<MarqumNativePlugin>? = null

        /** Called by [BankNotificationListener]; delivered only while the WebView bridge is alive. */
        fun emitCaptured(n: CapturedNotification) {
            val plugin = instance?.get() ?: return
            Handler(Looper.getMainLooper()).post { plugin.deliverCaptured(n) }
        }
    }
}
