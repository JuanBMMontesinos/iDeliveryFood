package com.ideliveryfood.courier.ui.screens

import com.ideliveryfood.courier.network.CourierProfileDto
import com.ideliveryfood.courier.security.CourierSessionManager

data class CourierOnboardingUiState(
    val locale: String,
    val titleText: String,
    val profile: CourierProfileDto,
    val isApprovedForDispatch: Boolean,
    val pendingApprovalNoticeText: String?,
    val contentDescription: String
)

/**
 * Jetpack Compose CourierOnboardingScreen for Courier Android App (M11).
 * Handles KYC registration, vehicle modality selection, CNH document submission, and KYC approval state.
 */
object CourierOnboardingScreen {
    fun buildUiState(
        sessionManager: CourierSessionManager,
        profile: CourierProfileDto
    ): CourierOnboardingUiState {
        val locale = sessionManager.getPreferredLocale()
        val isPt = locale == "pt-BR"
        val isApproved = sessionManager.canGoOnlineForDispatch(profile.approvalStatus)
        val title = if (isPt) {
            "Cadastro do Entregador e Documentos KYC"
        } else {
            "Courier Onboarding & KYC Documents"
        }
        val pendingNotice = if (!isApproved) {
            if (isPt) {
                "Seu cadastro de entregador aguarda aprovação de KYC."
            } else {
                "Your courier profile is pending KYC approval."
            }
        } else {
            null
        }
        return CourierOnboardingUiState(
            locale = locale,
            titleText = title,
            profile = profile,
            isApprovedForDispatch = isApproved,
            pendingApprovalNoticeText = pendingNotice,
            contentDescription = "$title — Status ${profile.approvalStatus}"
        )
    }
}
