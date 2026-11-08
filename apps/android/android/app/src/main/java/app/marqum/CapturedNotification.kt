package app.marqum

import com.getcapacitor.JSObject
import org.json.JSONObject

/** One captured bank notification. `key` (the system notification key) stays on the device. */
data class CapturedNotification(
    val id: String,
    val pkg: String,
    val title: String,
    val text: String,
    val postedAt: String,
    val key: String,
    val sent: Boolean = false,
    /** The server refused it permanently (4xx other than 401/403/408/409/429): don't retry. */
    val rejected: Boolean = false,
) {
    /** Body for POST /api/ingest/notification (NotificationIngest). */
    fun toIngestJson(): JSONObject =
        JSONObject()
            .put("id", id)
            .put("package", pkg)
            .put("title", title)
            .put("text", text)
            .put("posted_at", postedAt)

    /** Shape the web UI receives: NotificationIngest & { sent }. */
    fun toJs(): JSObject =
        JSObject().apply {
            put("id", id)
            put("package", pkg)
            put("title", title)
            put("text", text)
            put("posted_at", postedAt)
            put("sent", sent)
        }

    fun toStorageJson(): JSONObject = toIngestJson().put("key", key).put("sent", sent).put("rejected", rejected)

    companion object {
        fun fromStorageJson(o: JSONObject) =
            CapturedNotification(
                id = o.getString("id"),
                pkg = o.getString("package"),
                title = o.optString("title"),
                text = o.optString("text"),
                postedAt = o.getString("posted_at"),
                key = o.optString("key"),
                sent = o.optBoolean("sent"),
                rejected = o.optBoolean("rejected"),
            )
    }
}
