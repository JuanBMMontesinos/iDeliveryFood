package com.ideliveryfood.courier.ui.screens

import com.ideliveryfood.courier.dispatch.CourierDeliveryStage
import com.ideliveryfood.courier.dispatch.CourierDispatchController

data class CourierActiveDeliveryUiState(
    val locale: String,
    val titleText: String,
    val stage: CourierDeliveryStage,
    val fullCustomerAddress: String?,
    val isNetworkOnline: Boolean,
    val canCompleteDeliveryWithOtp: Boolean,
    val offlineCompletionBlockedNoticeText: String?,
    val otpPromptLabelText: String,
    val contentDescription: String
)

/**
 * Jetpack Compose CourierActiveDeliveryScreen for Courier Android App (M11).
 * Guides the courier through: En Route to Store -> Arrived at Store -> Picked Up ->
 * Arrived at Customer -> 4-digit OTP Verification. Blocks completion while offline.
 */
object CourierActiveDeliveryScreen {
    fun buildUiState(
        controller: CourierDispatchController
    ): CourierActiveDeliveryUiState {
        val locale = controller.selectedLocale
        val isPt = locale == "pt-BR"
        val title = if (isPt) "Andamento da Entrega Ativa" else "Active Delivery Progression"
        val otpLabel = if (isPt) {
            "Digite o código de confirmação de 4 dígitos do cliente"
        } else {
            "Enter 4-digit customer confirmation code"
        }
        val offlineNotice = if (!controller.isNetworkOnline) {
            if (isPt) {
                "Não é possível concluir a entrega offline. Evento enfileirado para validação no servidor."
            } else {
                "Cannot finalize delivery while offline. Event queued for server verification."
            }
        } else {
            null
        }

        return CourierActiveDeliveryUiState(
            locale = locale,
            titleText = title,
            stage = controller.stage,
            fullCustomerAddress = controller.currentOffer?.fullCustomerAddress,
            isNetworkOnline = controller.isNetworkOnline,
            canCompleteDeliveryWithOtp = controller.isNetworkOnline &&
                (controller.stage == CourierDeliveryStage.ARRIVED_AT_CUSTOMER ||
                    controller.stage == CourierDeliveryStage.PICKED_UP_EN_ROUTE_TO_CUSTOMER),
            offlineCompletionBlockedNoticeText = offlineNotice,
            otpPromptLabelText = otpLabel,
            contentDescription = "$title — Stage ${controller.stage.name}"
        )
    }
}
