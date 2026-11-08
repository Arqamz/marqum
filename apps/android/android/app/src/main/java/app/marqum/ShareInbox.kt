package app.marqum

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.core.content.IntentCompat
import com.getcapacitor.JSObject
import java.io.ByteArrayOutputStream
import java.io.File

/** Files shared into the app (ACTION_SEND / SEND_MULTIPLE / VIEW), copied into memory and queued for the web UI. */
object ShareInbox {
    private const val HANDLED_EXTRA = "app.marqum.SHARE_HANDLED"
    private val pending = mutableListOf<JSObject>()

    @Synchronized
    fun enqueue(files: List<JSObject>) {
        pending.addAll(files)
    }

    @Synchronized
    fun drain(): List<JSObject> {
        val out = pending.toList()
        pending.clear()
        return out
    }

    /** Extracts accepted files (.pdf / .csv) from a share or view intent. Each intent is handled once. */
    fun extract(context: Context, intent: Intent?): List<JSObject> {
        if (intent == null || intent.getBooleanExtra(HANDLED_EXTRA, false)) return emptyList()
        val uris: List<Uri> = when (intent.action) {
            Intent.ACTION_SEND ->
                listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
            Intent.ACTION_SEND_MULTIPLE ->
                IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.toList()
                    ?: emptyList()
            Intent.ACTION_VIEW -> listOfNotNull(intent.data)
            else -> return emptyList()
        }
        intent.putExtra(HANDLED_EXTRA, true)
        return uris.mapNotNull { uri -> runCatching { readUri(context, uri, intent.type) }.getOrNull() }
    }

    private fun readUri(context: Context, uri: Uri, intentType: String?): JSObject? {
        val resolver = context.contentResolver
        val name = displayName(context, uri) ?: return null
        val ext = name.substringAfterLast('.', "").lowercase()
        val mime = when (ext) {
            "pdf" -> "application/pdf"
            "csv" -> resolver.getType(uri)?.takeIf { it.startsWith("text/") } ?: "text/csv"
            else -> {
                val type = resolver.getType(uri) ?: intentType
                when (type) {
                    "application/pdf", "text/csv", "text/comma-separated-values" -> type
                    else -> return null // not a statement: ignore (the */* SEND filter lets anything in)
                }
            }
        }
        val bytes = readLimited(context, uri) ?: return null
        return JSObject().apply {
            put("name", name)
            put("mime", mime)
            put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        }
    }

    private fun displayName(context: Context, uri: Uri): String? {
        if (uri.scheme == "file") return uri.path?.let { File(it).name }
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0) c.getString(idx)?.let { return it }
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/')
    }

    private fun readLimited(context: Context, uri: Uri): ByteArray? {
        context.contentResolver.openInputStream(uri)?.use { input ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(64 * 1024)
            var total = 0L
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                total += n
                if (total > StatementInbox.MAX_BYTES) return null
                out.write(buf, 0, n)
            }
            return out.toByteArray()
        }
        return null
    }
}
