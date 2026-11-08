package app.marqum

import android.content.Context
import org.json.JSONArray
import java.io.File

/**
 * Small on-device log of captured bank notifications (JSON file in app-private storage, newest last).
 * Keeps the last [MAX_ENTRIES]; entries not yet sent are never evicted before sent ones.
 */
object NotificationLog {
    private const val FILE_NAME = "captured-notifications.json"
    const val MAX_ENTRIES = 200
    private val lock = Any()

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)

    private fun load(context: Context): MutableList<CapturedNotification> {
        val f = file(context)
        if (!f.exists()) return mutableListOf()
        return runCatching {
            val arr = JSONArray(f.readText())
            MutableList(arr.length()) { CapturedNotification.fromStorageJson(arr.getJSONObject(it)) }
        }.getOrElse { mutableListOf() }
    }

    private fun save(context: Context, items: List<CapturedNotification>) {
        val arr = JSONArray()
        items.forEach { arr.put(it.toStorageJson()) }
        val f = file(context)
        val tmp = File(f.parentFile, "$FILE_NAME.tmp")
        tmp.writeText(arr.toString())
        if (!tmp.renameTo(f)) {
            f.writeText(arr.toString())
            tmp.delete()
        }
    }

    /**
     * Appends unless it duplicates an entry already logged: same id, or the same system notification
     * re-posted (same key) with identical content.
     */
    fun append(context: Context, n: CapturedNotification): Boolean =
        synchronized(lock) {
            val items = load(context)
            val dup = items.any {
                it.id == n.id || (it.key == n.key && it.pkg == n.pkg && it.title == n.title && it.text == n.text)
            }
            if (dup) return false
            items.add(n)
            while (items.size > MAX_ENTRIES) {
                val idx = items.indexOfFirst { it.sent || it.rejected }
                items.removeAt(if (idx >= 0) idx else 0)
            }
            save(context, items)
            true
        }

    fun pending(context: Context): List<CapturedNotification> =
        synchronized(lock) { load(context).filter { !it.sent && !it.rejected } }

    fun pendingCount(context: Context): Int = pending(context).size

    fun mark(context: Context, id: String, sent: Boolean, rejected: Boolean) =
        synchronized(lock) {
            val items = load(context)
            val idx = items.indexOfFirst { it.id == id }
            if (idx >= 0) {
                items[idx] = items[idx].copy(sent = sent, rejected = rejected)
                save(context, items)
            }
        }

    /** Newest first. */
    fun recent(context: Context, limit: Int): List<CapturedNotification> =
        synchronized(lock) { load(context).asReversed().take(limit.coerceIn(0, MAX_ENTRIES)) }
}
