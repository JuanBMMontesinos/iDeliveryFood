package com.ideliveryfood.customer.security

import java.net.URI

/**
 * Secure session vault for Customer Android App (M03).
 * Uses Android Keystore + EncryptedSharedPreferences in production runtime
 * and enforces allowlisted deep links and default English ('en') locale.
 */
interface EncryptedKeyValueBackend {
    fun putString(key: String, value: String)
    fun getString(key: String): String?
    fun remove(key: String)
    fun clear()
}

class SecureSessionStore(private val backend: EncryptedKeyValueBackend) {
    companion object {
        private const val KEY_ACCESS_TOKEN = "auth.access_token"
        private const val KEY_REFRESH_TOKEN = "auth.refresh_token"
        private const val KEY_PREFERRED_LOCALE = "user.preferred_locale"
        const val DEFAULT_LOCALE = "en"
        val SUPPORTED_LOCALES = setOf("en", "pt-BR")
    }

    fun saveSessionTokens(accessToken: String, refreshToken: String) {
        require(accessToken.isNotBlank() && refreshToken.isNotBlank()) {
            "Session tokens must not be blank."
        }
        backend.putString(KEY_ACCESS_TOKEN, accessToken)
        backend.putString(KEY_REFRESH_TOKEN, refreshToken)
    }

    fun getAccessToken(): String? = backend.getString(KEY_ACCESS_TOKEN)

    fun revokeLocalSession() {
        backend.remove(KEY_ACCESS_TOKEN)
        backend.remove(KEY_REFRESH_TOKEN)
    }

    fun getPreferredLocale(): String {
        val stored = backend.getString(KEY_PREFERRED_LOCALE) ?: return DEFAULT_LOCALE
        return if (SUPPORTED_LOCALES.contains(stored)) stored else DEFAULT_LOCALE
    }

    fun setPreferredLocale(locale: String): String {
        val resolved = if (locale.lowercase().startsWith("pt")) "pt-BR" else "en"
        backend.putString(KEY_PREFERRED_LOCALE, resolved)
        return resolved
    }

    fun isAllowedDeepLink(rawUri: String): Boolean {
        return try {
            val uri = URI(rawUri)
            uri.scheme == "ideliveryfood-customer" && uri.host == "auth-callback"
        } catch (_: Exception) {
            false
        }
    }
}
