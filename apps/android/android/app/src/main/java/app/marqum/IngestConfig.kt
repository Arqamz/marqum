package app.marqum

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Where to POST captured notifications. The bearer token is encrypted with an AES-GCM key held in the
 * Android Keystore (non-exportable); the ciphertext lives in app-private SharedPreferences.
 */
object IngestConfig {
    private const val PREFS = "marqum_ingest"
    private const val KEY_API_BASE = "api_base"
    private const val KEY_TOKEN = "token_enc"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "marqum_ingest_token"

    data class Config(val apiBase: String, val token: String)

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(context: Context, apiBase: String, token: String) {
        val encrypted = encrypt(token)
        prefs(context).edit {
            putString(KEY_API_BASE, apiBase.trimEnd('/'))
            putString(KEY_TOKEN, encrypted)
        }
    }

    fun load(context: Context): Config? {
        val p = prefs(context)
        val base = p.getString(KEY_API_BASE, null) ?: return null
        val enc = p.getString(KEY_TOKEN, null) ?: return null
        val token = runCatching { decrypt(enc) }.getOrNull() ?: return null
        if (base.isEmpty() || token.isEmpty()) return null
        return Config(base, token)
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = cipher.iv
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(byteArrayOf(iv.size.toByte()) + iv + ct, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String): String {
        val raw = Base64.decode(encoded, Base64.NO_WRAP)
        val ivLen = raw[0].toInt()
        val iv = raw.copyOfRange(1, 1 + ivLen)
        val ct = raw.copyOfRange(1 + ivLen, raw.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }
}
