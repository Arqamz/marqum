package app.marqum

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Captures NayaPay / SadaPay notifications. Bound by the system while notification access is granted
 * (survives reboots without extra work). Never logs notification contents.
 */
class BankNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null || sbn.packageName !in BANK_PACKAGES) return
        val n = sbn.notification ?: return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val extras = n.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim()
        val text = big?.takeIf { it.isNotEmpty() }
            ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim().orEmpty()
        if (title.isEmpty() && text.isEmpty()) return

        val captured = CapturedNotification(
            id = sha256("${sbn.packageName}|${sbn.postTime}|$title|$text"),
            pkg = sbn.packageName,
            title = title,
            text = text,
            postedAt = karachiLocal(sbn.postTime),
            key = sbn.key ?: "",
        )
        val ctx = applicationContext
        if (!NotificationLog.append(ctx, captured)) return
        IngestUploader.schedule(ctx)
        MarqumNativePlugin.emitCaptured(captured)
    }

    companion object {
        val BANK_PACKAGES = setOf("com.nayapay.app", "com.sadapay.app")
        private val KARACHI: ZoneId = ZoneId.of("Asia/Karachi")
        private val LOCAL_MINUTE: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")

        fun karachiLocal(epochMs: Long): String = Instant.ofEpochMilli(epochMs).atZone(KARACHI).format(LOCAL_MINUTE)

        fun sha256(s: String): String =
            MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") {
                "%02x".format(it)
            }
    }
}
