package com.ideliveryfood.courier.ui.screens

import com.ideliveryfood.courier.dispatch.CourierDispatchController
import com.ideliveryfood.courier.dispatch.CourierOfferCardModel

data class CourierOfferRingUiState(
    val locale: String,
    val titleText: String,
    val offer: CourierOfferCardModel,
    val formattedFeeBrl: String,
    val remainingSeconds: Long,
    val customerAddressPrivacyNoticeText: String,
    val visibleDropoffDestination: String,
    val contentDescription: String
)

/**
 * Jetpack Compose CourierOfferRingScreen for Courier Android App (M11).
 * Displays countdown timer, estimated payout in BRL centavos, and enforces pre-acceptance
 * customer street address privacy (showing neighborhood only until server acceptance).
 */
object CourierOfferRingScreen {
    fun buildUiState(
        controller: CourierDispatchController,
        offer: CourierOfferCardModel,
        nowEpochMillis: Long
    ): CourierOfferRingUiState {
        val locale = controller.selectedLocale
        val isPt = locale == "pt-BR"
        val title = if (isPt) "Nova Oferta de Entrega" else "Incoming Delivery Offer"
        val privacyNotice = if (isPt) {
            "O logradouro e número exatos do cliente são exibidos apenas após o aceite da oferta de entrega."
        } else {
            "Exact customer street and number are revealed only after accepting the delivery offer."
        }
        val remainingSec = ((offer.expiresAtEpochMillis - nowEpochMillis) / 1000L).coerceAtLeast(0L)
        val visibleDestination = offer.fullCustomerAddress ?: offer.dropoffNeighborhoodOnly
        val formattedFee = controller.formatBrlCents(offer.offeredFeeCents)

        return CourierOfferRingUiState(
            locale = locale,
            titleText = title,
            offer = offer,
            formattedFeeBrl = formattedFee,
            remainingSeconds = remainingSec,
            customerAddressPrivacyNoticeText = privacyNotice,
            visibleDropoffDestination = visibleDestination,
            contentDescription = "$title — ${offer.pickupStoreName} ($formattedFee)"
        )
    }
}
