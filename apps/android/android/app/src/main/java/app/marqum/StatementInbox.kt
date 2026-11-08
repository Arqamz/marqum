package app.marqum

import android.os.Environment
import java.io.File

/** Finds bank statement files in the two folders the banks write to. */
object StatementInbox {
    private val NAME_PATTERNS = listOf(
        Regex("""^m-\d{2}-\d{4}\.(pdf|csv)$""", RegexOption.IGNORE_CASE), // NayaPay
        Regex("""^sadapay_account_statement_.*\.pdf$""", RegexOption.IGNORE_CASE), // SadaPay
    )

    private fun roots(): List<File> {
        val storage = Environment.getExternalStorageDirectory() // /storage/emulated/0
        return listOf(
            File(storage, "Android/media/com.nayapay.app/NayaPay/Other"),
            File(storage, Environment.DIRECTORY_DOWNLOADS),
        )
    }

    fun isStatementName(name: String): Boolean = NAME_PATTERNS.any { it.matches(name) }

    fun scan(since: Long): List<File> =
        roots()
            .flatMap { dir -> dir.listFiles()?.toList() ?: emptyList() }
            .filter { it.isFile && isStatementName(it.name) && it.lastModified() > since }
            .distinctBy { it.absolutePath }
            .sortedByDescending { it.lastModified() }

    /** Reads a file on shared storage. Only paths under external storage are allowed. */
    fun read(path: String): ByteArray {
        val file = File(path).canonicalFile
        val root = Environment.getExternalStorageDirectory().canonicalFile
        require(file.path.startsWith(root.path + File.separator)) { "Path is outside shared storage" }
        require(file.isFile) { "Not a file" }
        require(file.length() <= MAX_BYTES) { "File is too large" }
        return file.readBytes()
    }

    const val MAX_BYTES = 25L * 1024 * 1024
}
