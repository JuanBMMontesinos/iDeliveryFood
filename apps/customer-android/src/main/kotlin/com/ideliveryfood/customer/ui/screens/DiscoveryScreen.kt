package com.ideliveryfood.customer.ui.screens

import com.ideliveryfood.customer.marketplace.CustomerMarketplaceController
import com.ideliveryfood.customer.marketplace.MobilePublishedStore

enum class DiscoveryViewStatus {
    LOADING,
    READY,
    EMPTY,
    ERROR,
    OFFLINE
}

data class DiscoveryStoreCardUiModel(
    val id: String,
    val name: String,
    val localizedDescription: String,
    val cuisineCategory: String,
    val isPaused: Boolean,
    val formattedMinOrderBrl: String,
    val prepTimeLabel: String,
    val contentDescription: String
)

data class DiscoveryScreenUiState(
    val status: DiscoveryViewStatus,
    val locale: String,
    val headingText: String,
    val searchQuery: String,
    val selectedCuisine: String?,
    val bannerText: String?,
    val stores: List<DiscoveryStoreCardUiModel>,
    val contentDescription: String
)

/**
 * Jetpack Compose DiscoveryScreen for Customer Android App (M05 / M06).
 * Consumes live published stores from `/v1/stores`, formats minOrderCents in BRL,
 * and renders explicit LOADING / EMPTY / ERROR / OFFLINE states.
 */
object DiscoveryScreen {
    fun buildUiState(
        controller: CustomerMarketplaceController,
        stores: List<MobilePublishedStore>,
        searchQuery: String = "",
        selectedCuisine: String? = null,
        isLoading: Boolean = false,
        isOffline: Boolean = false,
        errorMessage: String? = null
    ): DiscoveryScreenUiState {
        val locale = controller.getLocale()
        val isPt = locale == "pt-BR"
        val heading = if (isPt) "Restaurantes Disponíveis" else "Available Restaurants"

        if (isLoading) {
            return DiscoveryScreenUiState(
                status = DiscoveryViewStatus.LOADING,
                locale = locale,
                headingText = heading,
                searchQuery = searchQuery,
                selectedCuisine = selectedCuisine,
                bannerText = if (isPt) "Carregando dados em tempo real da plataforma..." else "Loading live data from platform...",
                stores = emptyList(),
                contentDescription = "$heading — Loading"
            )
        }

        if (errorMessage != null) {
            return DiscoveryScreenUiState(
                status = DiscoveryViewStatus.ERROR,
                locale = locale,
                headingText = heading,
                searchQuery = searchQuery,
                selectedCuisine = selectedCuisine,
                bannerText = errorMessage,
                stores = emptyList(),
                contentDescription = "$heading — Error: $errorMessage"
            )
        }

        val filtered = stores.filter { store ->
            val matchesQuery = searchQuery.isBlank() ||
                store.name.contains(searchQuery, ignoreCase = true) ||
                store.descriptionEn.contains(searchQuery, ignoreCase = true) ||
                store.descriptionPtBr.contains(searchQuery, ignoreCase = true)
            val matchesCuisine = selectedCuisine.isNullOrBlank() ||
                store.cuisineCategory.equals(selectedCuisine, ignoreCase = true)
            matchesQuery && matchesCuisine
        }

        val cards = filtered.map { s ->
            val desc = if (isPt) s.descriptionPtBr else s.descriptionEn
            val minOrder = controller.formatBrlCents(s.minOrderCents)
            val prepLabel = "${s.prepTimeMinMinutes}-${s.prepTimeMaxMinutes} min"
            DiscoveryStoreCardUiModel(
                id = s.id,
                name = s.name,
                localizedDescription = desc,
                cuisineCategory = s.cuisineCategory,
                isPaused = s.isPaused,
                formattedMinOrderBrl = minOrder,
                prepTimeLabel = prepLabel,
                contentDescription = "${s.name}, ${s.cuisineCategory}, $prepLabel, min $minOrder"
            )
        }

        val status = when {
            isOffline -> DiscoveryViewStatus.OFFLINE
            cards.isEmpty() -> DiscoveryViewStatus.EMPTY
            else -> DiscoveryViewStatus.READY
        }

        val bannerText = when {
            isOffline -> if (isPt) {
                "Modo offline: exibindo catálogo em cache. Preços em tempo real e checkout exigem conexão ativa."
            } else {
                "Offline mode: displaying cached catalog. Live prices and checkout require an active connection."
            }
            cards.isEmpty() -> if (isPt) {
                "Nenhum restaurante disponível na sua região no momento."
            } else {
                "No restaurants available in your area right now."
            }
            else -> null
        }

        return DiscoveryScreenUiState(
            status = status,
            locale = locale,
            headingText = heading,
            searchQuery = searchQuery,
            selectedCuisine = selectedCuisine,
            bannerText = bannerText,
            stores = cards,
            contentDescription = "$heading (${cards.size})"
        )
    }
}
