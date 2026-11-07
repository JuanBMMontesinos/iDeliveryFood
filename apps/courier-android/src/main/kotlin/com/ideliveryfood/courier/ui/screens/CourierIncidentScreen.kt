package com.ideliveryfood.courier.ui.screens

import com.ideliveryfood.courier.dispatch.CourierDispatchController

data class CourierIncidentUiState(
    val locale: String,
    val titleText: String,
    val deliveryTaskId: String,
    val supportedCategories: List<String>,
    val submitButtonText: String,
    val contentDescription: String
)

/**
 * Jetpack Compose CourierIncidentScreen for Courier Android App (M11 / M14).
 * Allows couriers to report route hazards, customer no-show, damaged packaging, or store delays.
 */
object CourierIncidentScreen {
    val INCIDENT_CATEGORIES = listOf(
        "CUSTOMER_UNREACHABLE",
        "VEHICLE_BREAKDOWN",
        "DAMAGED_ITEMS",
        "STORE_EXCESSIVE_WAIT",
        "SAFETY_CONCERN"
    )

    fun buildUiState(
        controller: CourierDispatchController,
        deliveryTaskId: String
    ): CourierIncidentUiState {
        val locale = controller.selectedLocale
        val isPt = locale == "pt-BR"
        val title = if (isPt) "Relatar Incidente de Rota / Entrega" else "Report Delivery / Route Incident"
        val submitText = if (isPt) "Enviar Relato de Incidente" else "Submit Incident Report"

        return CourierIncidentUiState(
            locale = locale,
            titleText = title,
            deliveryTaskId = deliveryTaskId,
            supportedCategories = INCIDENT_CATEGORIES,
            submitButtonText = submitText,
            contentDescription = "$title — Task $deliveryTaskId"
        )
    }
}
