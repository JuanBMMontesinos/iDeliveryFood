package com.ideliveryfood.courier

import com.ideliveryfood.courier.dispatch.CourierDispatchController
import com.ideliveryfood.courier.navigation.CourierDeepLinkRoute
import com.ideliveryfood.courier.navigation.CourierDestinations
import com.ideliveryfood.courier.navigation.CourierNavHostState
import com.ideliveryfood.courier.navigation.resolveCourierDeepLinkRoute
import com.ideliveryfood.courier.security.CourierSessionManager

/**
 * Main entry point Activity for the iDeliveryFood Courier Android App (M11).
 * Hosts Jetpack Compose navigation, enforces allowlisted deep links, and initializes
 * the default English ('en') locale with runtime switch to 'pt-BR'.
 */
class CourierMainActivity(
    private val sessionManager: CourierSessionManager,
    val dispatchController: CourierDispatchController = CourierDispatchController(
        courierId = "00000000-0000-4000-8000-000000000041",
        initialLocale = sessionManager.getPreferredLocale()
    )
) {
    var navState: CourierNavHostState = CourierNavHostState(
        currentRoute = if (sessionManager.getAccessToken() != null) {
            CourierDestinations.AVAILABILITY
        } else {
            CourierDestinations.ONBOARDING
        },
        locale = sessionManager.getPreferredLocale()
    )
        private set

    fun handleIncomingDeepLink(rawUri: String): CourierDeepLinkRoute {
        val resolved = resolveCourierDeepLinkRoute(
            rawUri = rawUri,
            sessionManager = sessionManager
        )
        if (resolved.allowed && resolved.targetRoute != null) {
            navState = navState.copy(
                currentRoute = resolved.targetRoute,
                deepLinkEntityId = resolved.entityId
            )
        }
        return resolved
    }
}
