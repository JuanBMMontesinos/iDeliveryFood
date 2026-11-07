package com.ideliveryfood.customer.ui.screens

import com.ideliveryfood.customer.network.CustomerAddressDto

data class AddressListScreenUiState(
    val locale: String = "en",
    val headingText: String,
    val gpsPermissionGranted: Boolean,
    val gpsFallbackBannerText: String?,
    val addresses: List<CustomerAddressDto>,
    val selectedAddressId: String?,
    val contentDescription: String
)

/**
 * Jetpack Compose AddressListScreen for Customer Android App (M05 / M06).
 * Handles on-demand coarse/fine GPS permission with an explicit manual address entry
 * fallback banner when GPS permission is denied.
 */
object AddressListScreen {
    fun buildUiState(
        addresses: List<CustomerAddressDto>,
        gpsPermissionGranted: Boolean,
        locale: String = "en",
        selectedAddressId: String? = null
    ): AddressListScreenUiState {
        val isPt = locale == "pt-BR"
        val heading = if (isPt) "Meus Endereços de Entrega" else "My Delivery Addresses"
        val fallbackBanner = if (!gpsPermissionGranted) {
            if (isPt) {
                "Permissão de localização negada ou indisponível. Informe seu endereço manualmente abaixo."
            } else {
                "Location permission denied or unavailable. Enter your delivery address manually below."
            }
        } else {
            null
        }
        val effectiveSelectedId = selectedAddressId
            ?: addresses.firstOrNull { it.isDefault }?.id
            ?: addresses.firstOrNull()?.id

        return AddressListScreenUiState(
            locale = locale,
            headingText = heading,
            gpsPermissionGranted = gpsPermissionGranted,
            gpsFallbackBannerText = fallbackBanner,
            addresses = addresses,
            selectedAddressId = effectiveSelectedId,
            contentDescription = "$heading (${addresses.size})"
        )
    }
}
