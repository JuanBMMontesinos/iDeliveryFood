package com.ideliveryfood.customer

import com.ideliveryfood.customer.marketplace.CustomerMarketplaceController
import com.ideliveryfood.customer.navigation.CustomerDeepLinkRoute
import com.ideliveryfood.customer.navigation.CustomerNavHostState
import com.ideliveryfood.customer.navigation.resolveCustomerDeepLinkRoute
import com.ideliveryfood.customer.security.SecureSessionStore

/**
 * Main entry point Activity for the iDeliveryFood Customer Android App (M06).
 * Hosts Jetpack Compose navigation, enforces allowlisted deep links, and initializes
 * the default English ('en') locale with runtime switch to 'pt-BR'.
 */
class MainActivity(
    private val sessionStore: SecureSessionStore,
    private val marketplaceController: CustomerMarketplaceController = CustomerMarketplaceController(
        currentLocale = sessionStore.getPreferredLocale()
    )
) {
    var navState: CustomerNavHostState = CustomerNavHostState(
        currentRoute = if (sessionStore.getAccessToken() != null) "discovery" else "auth",
        locale = sessionStore.getPreferredLocale()
    )
        private set

    fun handleIncomingDeepLink(rawUri: String): CustomerDeepLinkRoute {
        val resolved = resolveCustomerDeepLinkRoute(
            rawUri = rawUri,
            marketplaceController = marketplaceController,
            sessionStore = sessionStore
        )
        if (resolved.allowed && resolved.targetRoute != null) {
            navState = navState.copy(
                currentRoute = resolved.targetRoute,
                deepLinkArgumentId = resolved.entityId
            )
        }
        return resolved
    }
}
