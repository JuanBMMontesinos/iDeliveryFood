package com.ideliveryfood.customer.marketplace

import java.net.URI
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

data class MobilePublishedStore(
    val id: String,
    val slug: String,
    val name: String,
    val descriptionEn: String,
    val descriptionPtBr: String,
    val cuisineCategory: String,
    val isPaused: Boolean,
    val minOrderCents: Int,
    val prepTimeMinMinutes: Int,
    val prepTimeMaxMinutes: Int
)

data class MobileCartItem(
    val productId: String,
    val quantity: Int,
    val notes: String? = null
)

data class MobileStoreAdditionDecision(
    val allowed: Boolean,
    val requiresStoreSwitchConfirmation: Boolean,
    val activeStoreId: String?,
    val items: List<MobileCartItem>
)

data class MobileCheckoutReadinessState(
    val isOffline: Boolean,
    val isCachedDataStale: Boolean,
    val canSubmitOrder: Boolean,
    val pspProviderStatus: String,
    val missingPspCredentials: List<String>,
    val bannerMessageKey: String?
)

/**
 * Native Android Customer Marketplace, Single-Store Cart & Checkout Readiness Controller (M06).
 * Enforces integer BRL centavos, single-store basket invariant, offline stale-cache checkout lock,
 * honest BLOCKED_MISSING_CREDENTIALS PSP status, and allowlisted deep links.
 */
class CustomerMarketplaceController(
    private var currentLocale: String = "en"
) {
    private var activeStoreId: String? = null
    private val cartItems = mutableListOf<MobileCartItem>()
    private var isOfflineMode: Boolean = false

    fun setLocale(locale: String): String {
        currentLocale = if (locale.lowercase().startsWith("pt")) "pt-BR" else "en"
        return currentLocale
    }

    fun getLocale(): String = currentLocale

    fun formatBrlCents(cents: Int): String {
        require(cents >= 0) { "Monetary cents must be a non-negative integer." }
        val formatLocale = if (currentLocale == "pt-BR") Locale("pt", "BR") else Locale.US
        val formatter = NumberFormat.getCurrencyInstance(formatLocale)
        formatter.currency = Currency.getInstance("BRL")
        return formatter.format(cents / 100.0)
    }

    fun addItemToBasket(
        targetStoreId: String,
        item: MobileCartItem,
        confirmStoreSwitch: Boolean = false
    ): MobileStoreAdditionDecision {
        require(item.quantity > 0) { "Quantity must be greater than zero." }

        if (activeStoreId != null && cartItems.isNotEmpty() && activeStoreId != targetStoreId) {
            if (!confirmStoreSwitch) {
                return MobileStoreAdditionDecision(
                    allowed = false,
                    requiresStoreSwitchConfirmation = true,
                    activeStoreId = activeStoreId,
                    items = cartItems.toList()
                )
            }
            cartItems.clear()
        }

        activeStoreId = targetStoreId
        val existingIdx = cartItems.indexOfFirst { it.productId == item.productId }
        if (existingIdx >= 0) {
            val current = cartItems[existingIdx]
            cartItems[existingIdx] = current.copy(quantity = current.quantity + item.quantity)
        } else {
            cartItems.add(item)
        }

        return MobileStoreAdditionDecision(
            allowed = true,
            requiresStoreSwitchConfirmation = false,
            activeStoreId = activeStoreId,
            items = cartItems.toList()
        )
    }

    fun setOfflineMode(offline: Boolean) {
        isOfflineMode = offline
    }

    fun evaluateCheckoutReadiness(
        pspStatus: String,
        missingEnvVars: List<String>
    ): MobileCheckoutReadinessState {
        if (isOfflineMode) {
            return MobileCheckoutReadinessState(
                isOffline = true,
                isCachedDataStale = true,
                canSubmitOrder = false,
                pspProviderStatus = pspStatus,
                missingPspCredentials = missingEnvVars,
                bannerMessageKey = "offline_stale_cache_banner"
            )
        }

        val pspBlocked = pspStatus == "BLOCKED_MISSING_CREDENTIALS" || pspStatus == "DISABLED"
        return MobileCheckoutReadinessState(
            isOffline = false,
            isCachedDataStale = false,
            canSubmitOrder = !pspBlocked && cartItems.isNotEmpty(),
            pspProviderStatus = pspStatus,
            missingPspCredentials = missingEnvVars,
            bannerMessageKey = if (pspBlocked) "checkout_psp_blocked_notice" else null
        )
    }

    fun isAllowedCustomerDeepLink(rawUri: String): Boolean {
        return try {
            val uri = URI(rawUri)
            if (uri.scheme != "ideliveryfood-customer") return false
            uri.host == "auth-callback" || uri.host == "orders" || uri.host == "stores"
        } catch (_: Exception) {
            false
        }
    }
}
