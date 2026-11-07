package com.ideliveryfood.courier.ui.screens

import com.ideliveryfood.courier.dispatch.CourierDispatchController
import com.ideliveryfood.courier.network.CourierSettlementDto

data class CourierEarningsUiState(
    val locale: String,
    val titleText: String,
    val settlements: List<CourierSettlementDto>,
    val totalNetEarningsCents: Int,
    val formattedTotalNetEarningsBrl: String,
    val contentDescription: String
)

/**
 * Jetpack Compose CourierEarningsScreen for Courier Android App (M11 / M13).
 * Displays real settlement statements and net courier earnings in integer BRL centavos.
 */
object CourierEarningsScreen {
    fun buildUiState(
        controller: CourierDispatchController,
        settlements: List<CourierSettlementDto>
    ): CourierEarningsUiState {
        val locale = controller.selectedLocale
        val isPt = locale == "pt-BR"
        val title = if (isPt) "Extrato de Ganhos e Repasses" else "Earnings Statement & Settlements"
        val totalNetCents = settlements.sumOf { it.netPayoutCents }
        val formattedTotal = controller.formatBrlCents(totalNetCents)

        return CourierEarningsUiState(
            locale = locale,
            titleText = title,
            settlements = settlements,
            totalNetEarningsCents = totalNetCents,
            formattedTotalNetEarningsBrl = formattedTotal,
            contentDescription = "$title — Total $formattedTotal"
        )
    }
}
