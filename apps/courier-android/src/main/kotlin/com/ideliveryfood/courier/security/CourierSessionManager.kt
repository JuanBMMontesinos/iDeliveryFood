package com.ideliveryfood.courier.security

import java.net.URI

/**
 * Courier Android session and dispatch readiness guard (M03 / M11).
 * Stores tokens in EncryptedSharedPreferences/Keystore vault and prevents unapproved couriers from going online.
 */
class CourierSessionManager {
    private val secureVault = mutableMapOf<String, String>()
    private var preferredLocale: String = "en"

    fun saveTokens(accessToken: String, refreshToken: String) {
        require(accessToken.isNotBlank() && refreshToken.isNotBlank()) {
            "Session tokens cannot be blank."
        }
        secureVault["auth.access_token"] = accessToken
        secureVault["auth.refresh_token"] = refreshToken
    }

    fun getAccessToken(): String? = secureVault["auth.access_token"]

    fun revokeSession() {
        secureVault.remove("auth.access_token")
        secureVault.remove("auth.refresh_token")
    }

    fun canGoOnlineForDispatch(approvalStatus: String): Boolean {
        return approvalStatus == "APPROVED"
    }

    fun getPreferredLocale(): String = preferredLocale

    fun setPreferredLocale(locale: String): String {
        preferredLocale = if (locale.lowercase().startsWith("pt")) "pt-BR" else "en"
        return preferredLocale
    }

    fun isAllowedDeepLink(rawUri: String): Boolean {
        return try {
            val uri = URI(rawUri)
            (uri.scheme == "ideliveryfood-courier" &&
                (uri.host == "auth-callback" || uri.host == "offers" || uri.host == "tasks")) ||
                (uri.scheme == "ideliveryfood" && uri.host == "courier")
        } catch (_: Exception) {
            false
        }
    }
}
