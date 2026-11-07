package com.ideliveryfood.customer.ui.screens

import com.ideliveryfood.customer.marketplace.CustomerMarketplaceController
import com.ideliveryfood.customer.network.CustomerOrderDto

data class OrderTrackingScreenUiState(
    val locale: String,
    val titleText: String,
    val order: CustomerOrderDto,
    val formattedTotalBrl: String,
    val otpNoticeText: String,
    val canSelfCancel: Boolean,
    val cancelWindowExpiredNoticeText: String?,
    val contentDescription: String
)

/**
 * Jetpack Compose OrderTrackingScreen for Customer Android App (M05 / M06 / M10).
 * Displays live order status, payment status, delivery status, 4-digit OTP delivery
 * confirmation instructions, and self-service cancellation window rules.
 */
object OrderTrackingScreen {
    fun buildUiState(
        controller: CustomerMarketplaceController,
        order: CustomerOrderDto,
        withinCancelWindow: Boolean = false
    ): OrderTrackingScreenUiState {
        val locale = controller.getLocale()
        val isPt = locale == "pt-BR"
        val title = if (isPt) {
            "Pedido #${order.orderNumber} — Acompanhamento em Tempo Real"
        } else {
            "Order #${order.orderNumber} — Live Tracking"
        }
        val canCancel = withinCancelWindow &&
            (order.orderStatus == "CREATED" || order.orderStatus == "PENDING_PAYMENT")

        val cancelExpiredText = if (!canCancel) {
            if (isPt) {
                "A janela de cancelamento direto expirou ou a cozinha já iniciou o preparo."
            } else {
                "Direct self-service cancellation window has elapsed or kitchen already started preparation."
            }
        } else {
            null
        }

        val otpText = if (isPt) {
            "Informe seu código de confirmação de entrega de 4 dígitos ao entregador apenas no recebimento."
        } else {
            "Share your 4-digit delivery confirmation code with the courier only upon handoff."
        }

        return OrderTrackingScreenUiState(
            locale = locale,
            titleText = title,
            order = order,
            formattedTotalBrl = controller.formatBrlCents(order.totalCents),
            otpNoticeText = otpText,
            canSelfCancel = canCancel,
            cancelWindowExpiredNoticeText = cancelExpiredText,
            contentDescription = "$title — Status ${order.orderStatus}"
        )
    }
}
