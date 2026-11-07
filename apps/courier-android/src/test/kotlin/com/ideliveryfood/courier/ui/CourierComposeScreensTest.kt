package com.ideliveryfood.courier.ui

import com.ideliveryfood.courier.CourierMainActivity
import com.ideliveryfood.courier.dispatch.CourierDeliveryStage
import com.ideliveryfood.courier.dispatch.CourierDispatchController
import com.ideliveryfood.courier.dispatch.CourierOfferCardModel
import com.ideliveryfood.courier.network.CourierProfileDto
import com.ideliveryfood.courier.network.CourierSettlementDto
import com.ideliveryfood.courier.security.CourierSessionManager
import com.ideliveryfood.courier.ui.screens.CourierActiveDeliveryScreen
import com.ideliveryfood.courier.ui.screens.CourierAvailabilityScreen
import com.ideliveryfood.courier.ui.screens.CourierEarningsScreen
import com.ideliveryfood.courier.ui.screens.CourierIncidentScreen
import com.ideliveryfood.courier.ui.screens.CourierOfferRingScreen
import com.ideliveryfood.courier.ui.screens.CourierOnboardingScreen
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CourierComposeScreensTest {
    @Test
    fun `verifies all 6 Courier Compose screens, pre-accept address privacy, offline completion block, and deep links`() {
        val session = CourierSessionManager()
        session.saveTokens("jwt_courier_1", "jwt_refresh_1")
        session.setPreferredLocale("pt-BR")

        val activity = CourierMainActivity(sessionManager = session)
        val deepLink = activity.handleIncomingDeepLink("ideliveryfood-courier://offers/91000000-0000-4000-8000-000000000001")
        assertTrue(deepLink.allowed)
        assertEquals("offers/91000000-0000-4000-8000-000000000001", activity.navState.currentRoute)

        val controller = CourierDispatchController(
            courierId = "00000000-0000-4000-8000-000000000041",
            initialLocale = "pt-BR"
        )
        controller.setOnlineAvailability(online = true, gpsGranted = true)

        val onboardingUi = CourierOnboardingScreen.buildUiState(
            sessionManager = session,
            profile = CourierProfileDto(
                courierId = controller.courierId,
                displayName = "Rafael Motoca",
                vehicleModality = "MOTORCYCLE",
                approvalStatus = "APPROVED",
                isAvailableOnline = true
            )
        )
        assertTrue(onboardingUi.isApprovedForDispatch)

        val availabilityUi = CourierAvailabilityScreen.buildUiState(
            sessionManager = session,
            controller = controller,
            approvalStatus = "APPROVED"
        )
        assertTrue(availabilityUi.isOnline)

        controller.receiveDispatchOffer(
            CourierOfferCardModel(
                offerId = "offer-1",
                deliveryTaskId = "task-1",
                pickupStoreName = "Paulista Artisan Burger",
                distanceMeters = 2400,
                offeredFeeCents = 1250,
                dropoffNeighborhoodOnly = "Bela Vista",
                fullCustomerAddress = "Av. Paulista, 1578 - Apto 42",
                expiresAtEpochMillis = 2000000000000L
            )
        )
        val ringUi = CourierOfferRingScreen.buildUiState(
            controller = controller,
            offer = controller.currentOffer!!,
            nowEpochMillis = 1999999970000L
        )
        assertNull(ringUi.offer.fullCustomerAddress)
        assertEquals("Bela Vista", ringUi.visibleDropoffDestination)

        controller.acceptCurrentOffer(
            nowEpochMillis = 1999999975000L,
            serverRevealedFullAddress = "Av. Paulista, 1578 - Apto 42, Bela Vista"
        )
        controller.markArrivedAtStore()
        controller.markPickedUpOrder()
        controller.markArrivedAtCustomer()

        controller.setNetworkConnectivity(false)
        val offlineActiveUi = CourierActiveDeliveryScreen.buildUiState(controller)
        assertFalse(offlineActiveUi.canCompleteDeliveryWithOtp)

        controller.setNetworkConnectivity(true)
        val otpResult = controller.attemptDeliveryCompletionWithOtp("4829", "4829")
        assertTrue(otpResult.isSuccess)
        assertEquals(CourierDeliveryStage.DELIVERED_CONFIRMED, controller.stage)

        val incidentUi = CourierIncidentScreen.buildUiState(controller, "task-1")
        assertTrue(incidentUi.supportedCategories.contains("CUSTOMER_UNREACHABLE"))

        val earningsUi = CourierEarningsScreen.buildUiState(
            controller = controller,
            settlements = listOf(
                CourierSettlementDto(
                    settlementId = "settle-1",
                    beneficiaryId = controller.courierId,
                    periodStartIso = "2026-11-01T00:00:00Z",
                    periodEndIso = "2026-11-07T23:59:59Z",
                    grossCents = 45000,
                    platformFeeCents = 0,
                    netPayoutCents = 45000,
                    payoutStatus = "PAID"
                )
            )
        )
        assertEquals(45000, earningsUi.totalNetEarningsCents)
    }
}
