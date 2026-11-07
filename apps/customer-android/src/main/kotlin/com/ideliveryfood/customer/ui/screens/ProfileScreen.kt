package com.ideliveryfood.customer.ui.screens

import com.ideliveryfood.customer.security.SecureSessionStore

data class CustomerDeviceSessionItem(
    val id: String,
    val platform: String,
    val deviceIdentifier: String,
    val isRevoked: Boolean
)

data class ProfileScreenUiState(
    val locale: String,
    val titleText: String,
    val fullName: String,
    val email: String,
    val devices: List<CustomerDeviceSessionItem>,
    val lgpdDeleteAccountButtonText: String,
    val lgpdRetentionHoldNoticeText: String?,
    val contentDescription: String
)

/**
 * Jetpack Compose ProfileScreen for Customer Android App (M03 / M05 / M06 / M20).
 * Manages preferred locale ('en' default, 'pt-BR' switchable), active device sessions
 * with revocation, verified order review/support links, and LGPD account deletion requests.
 */
object ProfileScreen {
    fun buildUiState(
        sessionStore: SecureSessionStore,
        fullName: String,
        email: String,
        devices: List<CustomerDeviceSessionItem>,
        retentionHoldUntilIso: String? = null
    ): ProfileScreenUiState {
        val locale = sessionStore.getPreferredLocale()
        val isPt = locale == "pt-BR"
        val title = if (isPt) {
            "Meu Perfil, Dispositivos e Privacidade LGPD"
        } else {
            "My Profile, Devices & LGPD Privacy"
        }
        val deleteBtnText = if (isPt) {
            "Solicitar exclusão de conta (LGPD)"
        } else {
            "Request account deletion (LGPD)"
        }
        val holdNotice = if (retentionHoldUntilIso != null) {
            if (isPt) {
                "Exclusão de conta retida devido a pedido ativo ou obrigação legal até $retentionHoldUntilIso."
            } else {
                "Account deletion deferred due to active order or statutory retention hold until $retentionHoldUntilIso."
            }
        } else {
            null
        }

        return ProfileScreenUiState(
            locale = locale,
            titleText = title,
            fullName = fullName,
            email = email,
            devices = devices,
            lgpdDeleteAccountButtonText = deleteBtnText,
            lgpdRetentionHoldNoticeText = holdNotice,
            contentDescription = "$title — $fullName"
        )
    }
}
