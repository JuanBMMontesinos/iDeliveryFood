package com.ideliveryfood.courier.dispatch

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CourierDispatchControllerTest {
    @Test
    fun `hides full customer street before offer acceptance and reveals only after acceptance`() {
        val controller = CourierDispatchController(courierId = "courier_01", initialLocale = "en")
        controller.setOnlineAvailability(online = true, gpsGranted = true)

        controller.receiveDispatchOffer(
            CourierOfferCardModel(
                offerId = "off_1",
                deliveryTaskId = "task_1",
                pickupStoreName = "Paulista Artisan Burger",
                distanceMeters = 1420,
                offeredFeeCents = 850,
                dropoffNeighborhoodOnly = "Bela Vista",
                fullCustomerAddress = "SHOULD_BE_STRIPPED",
                expiresAtEpochMillis = 2_000_000L
            )
        )

        assertNull(controller.currentOffer?.fullCustomerAddress)
        assertEquals("Bela Vista", controller.currentOffer?.dropoffNeighborhoodOnly)

        val accepted = controller.acceptCurrentOffer(
            nowEpochMillis = 1_500_000L,
            serverRevealedFullAddress = "Av. Paulista, 1578 - Apt 42, Bela Vista"
        )
        assertEquals("Av. Paulista, 1578 - Apt 42, Bela Vista", accepted.fullCustomerAddress)
        assertEquals(CourierDeliveryStage.ASSIGNED_EN_ROUTE_TO_STORE, controller.stage)
    }

    @Test
    fun `blocks fake delivery completion while offline and enforces 4-digit OTP when online`() {
        val controller = CourierDispatchController(courierId = "courier_01", initialLocale = "pt-BR")
        controller.setOnlineAvailability(online = true, gpsGranted = true)
        controller.setNetworkConnectivity(online = false)

        val offlineAttempt = controller.attemptDeliveryCompletionWithOtp("4829", "4829")
        assertTrue(offlineAttempt.isFailure)

        controller.setNetworkConnectivity(online = true)
        val wrongOtp = controller.attemptDeliveryCompletionWithOtp("0000", "4829")
        assertTrue(wrongOtp.isFailure)

        val validOtp = controller.attemptDeliveryCompletionWithOtp("4829", "4829")
        assertTrue(validOtp.isSuccess)
        assertEquals(CourierDeliveryStage.DELIVERED_CONFIRMED, controller.stage)
    }

    @Test
    fun `surfaces GPS permission denied banner when location access is revoked`() {
        val controller = CourierDispatchController(courierId = "courier_01")
        controller.setOnlineAvailability(online = true, gpsGranted = false)
        assertEquals(false, controller.isOnline)
        assertNotNull(controller.gpsWarningBannerKey())
    }
}
