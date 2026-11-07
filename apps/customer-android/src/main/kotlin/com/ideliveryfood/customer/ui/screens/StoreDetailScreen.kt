package com.ideliveryfood.customer.ui.screens

import com.ideliveryfood.customer.marketplace.CustomerMarketplaceController
import com.ideliveryfood.customer.network.CustomerCatalogOptionGroupDto
import com.ideliveryfood.customer.network.CustomerCatalogProductDto
import com.ideliveryfood.customer.network.CustomerStoreDetailDto

data class OptionSelectionValidationResult(
    val valid: Boolean,
    val violatedGroupId: String?,
    val errorMessage: String?
)

data class StoreDetailScreenUiState(
    val storeId: String,
    val storeName: String,
    val locale: String,
    val isPaused: Boolean,
    val products: List<CustomerCatalogProductDto>,
    val formattedPricesByProductId: Map<String, String>,
    val contentDescription: String
)

/**
 * Jetpack Compose StoreDetailScreen for Customer Android App (M04 / M05 / M06).
 * Displays store catalog products in BRL integer centavos and validates required
 * option group min/max rules before adding an item to the single-store basket.
 */
object StoreDetailScreen {
    fun buildUiState(
        controller: CustomerMarketplaceController,
        detail: CustomerStoreDetailDto
    ): StoreDetailScreenUiState {
        val locale = controller.getLocale()
        val prices = detail.products.associate { product ->
            product.id to controller.formatBrlCents(product.priceCents)
        }
        return StoreDetailScreenUiState(
            storeId = detail.store.id,
            storeName = detail.store.name,
            locale = locale,
            isPaused = detail.store.isPaused,
            products = detail.products,
            formattedPricesByProductId = prices,
            contentDescription = "${detail.store.name} — Menu (${detail.products.size} items)"
        )
    }

    fun validateOptionSelections(
        optionGroups: List<CustomerCatalogOptionGroupDto>,
        selectionsByGroupId: Map<String, List<String>>,
        locale: String = "en"
    ): OptionSelectionValidationResult {
        val isPt = locale == "pt-BR"
        for (group in optionGroups) {
            val selectedCount = selectionsByGroupId[group.id]?.size ?: 0
            if (selectedCount < group.minSelections) {
                return OptionSelectionValidationResult(
                    valid = false,
                    violatedGroupId = group.id,
                    errorMessage = if (isPt) {
                        "Obrigatório selecionar ao menos ${group.minSelections} em ${group.localizedName}"
                    } else {
                        "Please select at least ${group.minSelections} in ${group.localizedName}"
                    }
                )
            }
            if (selectedCount > group.maxSelections) {
                return OptionSelectionValidationResult(
                    valid = false,
                    violatedGroupId = group.id,
                    errorMessage = if (isPt) {
                        "Máximo de ${group.maxSelections} opções permitido em ${group.localizedName}"
                    } else {
                        "Maximum of ${group.maxSelections} selections allowed in ${group.localizedName}"
                    }
                )
            }
        }
        return OptionSelectionValidationResult(
            valid = true,
            violatedGroupId = null,
            errorMessage = null
        )
    }
}
