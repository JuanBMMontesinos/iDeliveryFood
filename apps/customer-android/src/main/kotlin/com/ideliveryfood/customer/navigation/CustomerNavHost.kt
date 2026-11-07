package com.ideliveryfood.customer.navigation

import com.ideliveryfood.customer.marketplace.CustomerMarketplaceController
import com.ideliveryfood.customer.security.SecureSessionStore
import java.net.URI

data class CustomerNavHostState(
    val currentRoute: String = "discovery",
    val locale: String = "en",
    val deepLinkArgumentId: String? = null
)

data class CustomerDeepLinkRoute(
    val allowed: Boolean,
    val targetRoute: String?,
    val entityId: String?,
    val rejectionReason: String?
)

object CustomerDestinations {
    const val AUTH = "auth"
    const val ADDRESSES = "addresses"
    const val DISCOVERY = "discovery"
    const val STORE_DETAIL = "store/{storeId}"
    const val CART = "cart"
    const val CHECKOUT = "checkout"
    const val ORDER_TRACKING = "orders/{orderId}"
    const val PROFILE = "profile"

    val ALL_ROUTES = listOf(
        AUTH,
        ADDRESSES,
        DISCOVERY,
        STORE_DETAIL,
        CART,
        CHECKOUT,
        ORDER_TRACKING,
        PROFILE
    )
}

/**
 * Resolves allowlisted customer deep links (`ideliveryfood-customer://auth-callback`,
 * `ideliveryfood-customer://orders/{id}`, `ideliveryfood-customer://stores/{id}`,
 * `ideliveryfood://orders/{id}`) and rejects untrusted schemes/hosts.
 */
fun resolveCustomerDeepLinkRoute(
    rawUri: String,
    marketplaceController: CustomerMarketplaceController,
    sessionStore: SecureSessionStore
): CustomerDeepLinkRoute {
    return try {
        val uri = URI(rawUri)
        val scheme = uri.scheme ?: ""
        val host = uri.host ?: ""
        val pathSegment = (uri.path ?: "").trim('/')

        if (scheme == "ideliveryfood-customer" && host == "auth-callback") {
            return CustomerDeepLinkRoute(
                allowed = sessionStore.isAllowedDeepLink(rawUri),
                targetRoute = CustomerDestinations.DISCOVERY,
                entityId = null,
                rejectionReason = null
            )
        }

        if ((scheme == "ideliveryfood-customer" || scheme == "ideliveryfood") && host == "orders") {
            if (pathSegment.isBlank()) {
                return CustomerDeepLinkRoute(false, null, null, "MISSING_ORDER_ID")
            }
            return CustomerDeepLinkRoute(
                allowed = true,
                targetRoute = "orders/$pathSegment",
                entityId = pathSegment,
                rejectionReason = null
            )
        }

        if (scheme == "ideliveryfood-customer" && host == "stores") {
            if (pathSegment.isBlank()) {
                return CustomerDeepLinkRoute(false, null, null, "MISSING_STORE_ID")
            }
            return CustomerDeepLinkRoute(
                allowed = marketplaceController.isAllowedCustomerDeepLink(rawUri),
                targetRoute = "store/$pathSegment",
                entityId = pathSegment,
                rejectionReason = null
            )
        }

        CustomerDeepLinkRoute(
            allowed = false,
            targetRoute = null,
            entityId = null,
            rejectionReason = "UNTRUSTED_DEEP_LINK_SCHEME_OR_HOST"
        )
    } catch (_: Exception) {
        CustomerDeepLinkRoute(
            allowed = false,
            targetRoute = null,
            entityId = null,
            rejectionReason = "MALFORMED_DEEP_LINK_URI"
        )
    }
}
