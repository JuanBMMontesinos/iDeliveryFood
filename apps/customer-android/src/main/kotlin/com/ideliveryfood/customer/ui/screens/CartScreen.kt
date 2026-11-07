package com.ideliveryfood.customer.ui.screens

import com.ideliveryfood.customer.marketplace.MobileCartItem
import com.ideliveryfood.customer.marketplace.MobileStoreAdditionDecision

data class CartScreenUiState(
    val locale: String,
    val titleText: String,
    val activeStoreId: String?,
    val items: List<MobileCartItem>,
    val isEmpty: Boolean,
    val emptyBannerText: String?,
    val showStoreSwitchDialog: Boolean,
    val storeSwitchDialogTitle: String?,
    val storeSwitchDialogBody: String?,
    val contentDescription: String
)

/**
 * Jetpack Compose CartScreen for Customer Android App (M05 / M06).
 * Enforces the single-store basket invariant and displays an explicit confirmation
 * dialog when adding an item from a different restaurant.
 */
object CartScreen {
    fun buildUiState(
        decision: MobileStoreAdditionDecision,
        locale: String = "en"
    ): CartScreenUiState {
        val isPt = locale == "pt-BR"
        val title = if (isPt) "Sua Sacola" else "Your Basket"
        val isEmpty = decision.items.isEmpty()
        val emptyBanner = if (isEmpty) {
            if (isPt) "Sua sacola está vazia." else "Your basket is empty."
        } else {
            null
        }
        val showSwitchDialog = decision.requiresStoreSwitchConfirmation
        return CartScreenUiState(
            locale = locale,
            titleText = title,
            activeStoreId = decision.activeStoreId,
            items = decision.items,
            isEmpty = isEmpty,
            emptyBannerText = emptyBanner,
            showStoreSwitchDialog = showSwitchDialog,
            storeSwitchDialogTitle = if (showSwitchDialog) {
                if (isPt) "Iniciar uma nova sacola em outra loja?" else "Start a new basket at another store?"
            } else {
                null
            },
            storeSwitchDialogBody = if (showSwitchDialog) {
                if (isPt) {
                    "Sua sacola atual possui itens de outro restaurante. Ao confirmar, sua sacola será substituída."
                } else {
                    "Your current basket has items from another restaurant. Confirming will replace your basket."
                }
            } else {
                null
            },
            contentDescription = "$title (${decision.items.size} items)"
        )
    }
}
