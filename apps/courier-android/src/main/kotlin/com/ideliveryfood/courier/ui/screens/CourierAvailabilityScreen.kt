package com.ideliveryfood.courier.ui.screens

import com.ideliveryfood.courier.dispatch.CourierDispatchController
import com.ideliveryfood.courier.security.CourierSessionManager

data class CourierAvailabilityUiState(
    val locale: String,
    val titleText: String,
    val statusBadgeText: String,
    val isOnline: Boolean,
    val isGpsGranted: Boolean,
    val gpsWarningBannerText: String?,
    val queuedOfflineLocationsCount: Int,
    val contentDescription: String
)

/**
 * Jetpack Compose CourierAvailabilityScreen for Courier Android App (M11).
 * Controls shift Online/Offline toggle requiring both KYC approval and real GPS permission.
 */
object CourierAvailabilityScreen {
    fun buildUiState(
        sessionManager: CourierSessionManager,
        controller: CourierDispatchController,
        approvalStatus: String
    ): CourierAvailabilityUiState {
        val locale = controller.selectedLocale
        val isPt = locale == "pt-BR"
        val canGoOnline = sessionManager.canGoOnlineForDispatch(approvalStatus)
        val effectiveOnline = canGoOnline && controller.isOnline
        val title = if (isPt) {
            "Disponibilidade de Turno e Telemetria GPS"
        } else {
            "Shift Availability & GPS Telemetry"
        }
        val statusText = if (effectiveOnline) {
            if (isPt) "Online — Pronto para ofertas de entrega" else "Online — Ready for dispatch offers"
        } else {
            "Offline"
        }
        val gpsBanner = if (!controller.isGpsPermissionGranted) {
            if (isPt) {
                "Permissão de localização negada. O rastreamento em rota está pausado; ative o GPS ou acione o suporte."
            } else {
                "Location permission is denied. Live route tracking is paused; please enable GPS or contact support."
            }
        } else {
            null
        }

        return CourierAvailabilityUiState(
            locale = locale,
            titleText = title,
            statusBadgeText = statusText,
            isOnline = effectiveOnline,
            isGpsGranted = controller.isGpsPermissionGranted,
            gpsWarningBannerText = gpsBanner,
            queuedOfflineLocationsCount = controller.queuedOfflineSamplesCount(),
            contentDescription = "$title — $statusText"
        )
    }
}
