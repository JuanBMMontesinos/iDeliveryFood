package com.ideliveryfood.customer.ui.screens

import com.ideliveryfood.customer.marketplace.CustomerMarketplaceController
import com.ideliveryfood.customer.marketplace.MobileCheckoutReadinessState
import com.ideliveryfood.customer.network.ServerQuoteDto

data class CheckoutScreenUiState(
    val locale: String,
    val titleText: String,
    val quote: ServerQuoteDto?,
    val formattedSubtotalBrl: String,
    val formattedAddonsBrl: String,
    val formattedServiceFeeBrl: String,
    val formattedDeliveryFeeBrl: String,
    val formattedDiscountBrl: String,
    val formattedTotalBrl: String,
    val readiness: MobileCheckoutReadinessState,
    val honestPspBlockedBannerText: String?,
    val contentDescription: String
)

/**
 * Jetpack Compose CheckoutScreen for Customer Android App (M05 / M06 / M10 / M12).
 * Renders server-side authoritative quote breakdown in BRL centavos and enforces
 * honest BLOCKED_MISSING_CREDENTIALS PSP status and offline stale-cache lock.
 */
object CheckoutScreen {
    fun buildUiState(
        controller: CustomerMarketplaceController,
        quote: ServerQuoteDto?,
        pspStatus: String = "BLOCKED_MISSING_CREDENTIALS",
        missingEnvVars: List<String> = listOf("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET")
    ): CheckoutScreenUiState {
        val locale = controller.getLocale()
        val isPt = locale == "pt-BR"
        val title = if (isPt) "Cotação do Servidor e Checkout" else "Server Quote & Checkout"
        val readiness = controller.evaluateCheckoutReadiness(
            pspStatus = pspStatus,
            missingEnvVars = missingEnvVars
        )

        val blockedNotice = if (readiness.bannerMessageKey == "checkout_psp_blocked_notice") {
            if (isPt) {
                "A captura de pagamento online está bloqueada neste ambiente por ausência de credenciais do PSP (${missingEnvVars.joinToString(", ")})."
            } else {
                "Online payment capture is blocked in this environment due to missing PSP credentials (${missingEnvVars.joinToString(", ")})."
            }
        } else if (readiness.bannerMessageKey == "offline_stale_cache_banner") {
            if (isPt) {
                "Modo offline: exibindo catálogo em cache. Preços em tempo real e checkout exigem conexão ativa."
            } else {
                "Offline mode: displaying cached catalog. Live prices and checkout require an active connection."
            }
        } else {
            null
        }

        val totalFormatted = controller.formatBrlCents(quote?.totalCents ?: 0)
        return CheckoutScreenUiState(
            locale = locale,
            titleText = title,
            quote = quote,
            formattedSubtotalBrl = controller.formatBrlCents(quote?.subtotalCents ?: 0),
            formattedAddonsBrl = controller.formatBrlCents(quote?.addonsCents ?: 0),
            formattedServiceFeeBrl = controller.formatBrlCents(quote?.serviceFeeCents ?: 0),
            formattedDeliveryFeeBrl = controller.formatBrlCents(quote?.deliveryFeeCents ?: 0),
            formattedDiscountBrl = controller.formatBrlCents(quote?.discountCents ?: 0),
            formattedTotalBrl = totalFormatted,
            readiness = readiness,
            honestPspBlockedBannerText = blockedNotice,
            contentDescription = "$title — Total $totalFormatted"
        )
    }
}
