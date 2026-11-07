package com.ideliveryfood.courier.navigation

import com.ideliveryfood.courier.security.CourierSessionManager
import java.net.URI

data class CourierNavHostState(
    val currentRoute: String = CourierDestinations.AVAILABILITY,
    val locale: String = "en",
    val deepLinkEntityId: String? = null
)

data class CourierDeepLinkRoute(
    val allowed: Boolean,
    val targetRoute: String?,
    val entityId: String?,
    val rejectionReason: String?
)

object CourierDestinations {
    const val ONBOARDING = "onboarding"
    const val AVAILABILITY = "availability"
    const val OFFER_RING = "offers/{offerId}"
    const val ACTIVE_DELIVERY = "tasks/{taskId}"
    const val INCIDENT = "incident/{taskId}"
    const val EARNINGS = "earnings"

    val ALL_ROUTES = listOf(
        ONBOARDING,
        AVAILABILITY,
        OFFER_RING,
        ACTIVE_DELIVERY,
        INCIDENT,
        EARNINGS
    )
}

/**
 * Resolves allowlisted courier deep links (`ideliveryfood-courier://auth-callback`,
 * `ideliveryfood-courier://offers/{id}`, `ideliveryfood-courier://tasks/{id}`,
 * `ideliveryfood://courier`) and rejects untrusted schemes/hosts.
 */
fun resolveCourierDeepLinkRoute(
    rawUri: String,
    sessionManager: CourierSessionManager
): CourierDeepLinkRoute {
    return try {
        val uri = URI(rawUri)
        val scheme = uri.scheme ?: ""
        val host = uri.host ?: ""
        val pathSegment = (uri.path ?: "").trim('/')

        if (!sessionManager.isAllowedDeepLink(rawUri)) {
            return CourierDeepLinkRoute(
                allowed = false,
                targetRoute = null,
                entityId = null,
                rejectionReason = "UNTRUSTED_DEEP_LINK_SCHEME_OR_HOST"
            )
        }

        if (scheme == "ideliveryfood-courier" && host == "auth-callback") {
            return CourierDeepLinkRoute(
                allowed = true,
                targetRoute = CourierDestinations.AVAILABILITY,
                entityId = null,
                rejectionReason = null
            )
        }

        if (scheme == "ideliveryfood-courier" && host == "offers") {
            if (pathSegment.isBlank()) {
                return CourierDeepLinkRoute(false, null, null, "MISSING_OFFER_ID")
            }
            return CourierDeepLinkRoute(
                allowed = true,
                targetRoute = "offers/$pathSegment",
                entityId = pathSegment,
                rejectionReason = null
            )
        }

        if (scheme == "ideliveryfood-courier" && host == "tasks") {
            if (pathSegment.isBlank()) {
                return CourierDeepLinkRoute(false, null, null, "MISSING_TASK_ID")
            }
            return CourierDeepLinkRoute(
                allowed = true,
                targetRoute = "tasks/$pathSegment",
                entityId = pathSegment,
                rejectionReason = null
            )
        }

        if (scheme == "ideliveryfood" && host == "courier") {
            return CourierDeepLinkRoute(
                allowed = true,
                targetRoute = CourierDestinations.AVAILABILITY,
                entityId = null,
                rejectionReason = null
            )
        }

        CourierDeepLinkRoute(
            allowed = false,
            targetRoute = null,
            entityId = null,
            rejectionReason = "UNTRUSTED_DEEP_LINK_SCHEME_OR_HOST"
        )
    } catch (_: Exception) {
        CourierDeepLinkRoute(
            allowed = false,
            targetRoute = null,
            entityId = null,
            rejectionReason = "MALFORMED_DEEP_LINK_URI"
        )
    }
}
