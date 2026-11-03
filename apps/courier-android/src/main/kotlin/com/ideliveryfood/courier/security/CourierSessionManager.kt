package com.ideliveryfood.courier.security

import java.net.URI

/**
 * Courier Android session and dispatch readiness guard (M03).
 * Prevents unapproved couriers from going online for dispatch offers.
 */
class CourierSessionManager {
    private var preferredLocale: String = "en"

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
            uri.scheme == "ideliveryfood-courier" && uri.host == "auth-callback"
        } catch (_: Exception) {
            false
        }
    }
}
