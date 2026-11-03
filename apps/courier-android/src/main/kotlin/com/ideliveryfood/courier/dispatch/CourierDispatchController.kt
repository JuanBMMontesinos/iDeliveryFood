package com.ideliveryfood.courier.dispatch

data class CourierOfferCardModel(
    val offerId: String,
    val deliveryTaskId: String,
    val pickupStoreName: String,
    val distanceMeters: Int,
    val offeredFeeCents: Int,
    val dropoffNeighborhoodOnly: String,
    val fullCustomerAddress: String?, // Null until offer is accepted (M11 privacy rule)
    val expiresAtEpochMillis: Long
)

data class CourierLocationQueueSample(
    val deliveryTaskId: String?,
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Double,
    val recordedAtEpochMillis: Long
)

enum class CourierDeliveryStage {
    IDLE,
    OFFER_RINGING,
    ASSIGNED_EN_ROUTE_TO_STORE,
    ARRIVED_AT_STORE,
    PICKED_UP_EN_ROUTE_TO_CUSTOMER,
    ARRIVED_AT_CUSTOMER,
    DELIVERED_CONFIRMED
}

/**
 * Native Kotlin State & Dispatch Controller for the iDeliveryFood Courier Android App (M11).
 *
 * Enforces:
 * - Customer street address privacy before offer acceptance (neighborhood only until ACCEPTED).
 * - GPS permission denial notice without faking coordinates.
 * - Offline telemetry queueing without faking delivery completion while offline.
 * - 4-digit OTP proof-of-delivery verification.
 */
class CourierDispatchController(
    val courierId: String,
    initialLocale: String = "en"
) {
    var selectedLocale: String = if (initialLocale == "pt-BR") "pt-BR" else "en"
        private set

    var isOnline: Boolean = false
        private set

    var isGpsPermissionGranted: Boolean = true
        private set

    var isNetworkOnline: Boolean = true
        private set

    var stage: CourierDeliveryStage = CourierDeliveryStage.IDLE
        private set

    var currentOffer: CourierOfferCardModel? = null
        private set

    private val offlineLocationQueue = mutableListOf<CourierLocationQueueSample>()

    fun switchLocale(newLocale: String): String {
        selectedLocale = if (newLocale == "pt-BR") "pt-BR" else "en"
        return selectedLocale
    }

    fun setOnlineAvailability(online: Boolean, gpsGranted: Boolean) {
        isGpsPermissionGranted = gpsGranted
        isOnline = online && gpsGranted
    }

    fun setNetworkConnectivity(online: Boolean) {
        isNetworkOnline = online
    }

    fun gpsWarningBannerKey(): String? {
        return if (!isGpsPermissionGranted) "courier_gps_permission_denied_notice" else null
    }

    fun receiveDispatchOffer(offer: CourierOfferCardModel) {
        require(isOnline) { "COURIER_OFFLINE: Cannot receive offer while offline." }
        // Enforce privacy: full address is always null while ringing
        currentOffer = offer.copy(fullCustomerAddress = null)
        stage = CourierDeliveryStage.OFFER_RINGING
    }

    fun acceptCurrentOffer(
        nowEpochMillis: Long,
        serverRevealedFullAddress: String
    ): CourierOfferCardModel {
        require(isOnline) { "COURIER_OFFLINE: Must be online to accept offer." }
        val offer = currentOffer ?: throw IllegalStateException("NO_ACTIVE_OFFER")
        require(nowEpochMillis < offer.expiresAtEpochMillis) { "DELIVERY_OFFER_EXPIRED" }

        val accepted = offer.copy(fullCustomerAddress = serverRevealedFullAddress)
        currentOffer = accepted
        stage = CourierDeliveryStage.ASSIGNED_EN_ROUTE_TO_STORE
        return accepted
    }

    fun recordLocationSample(sample: CourierLocationQueueSample): Boolean {
        if (!isGpsPermissionGranted) {
            return false
        }
        if (!isNetworkOnline) {
            offlineLocationQueue.add(sample)
            return false
        }
        return true
    }

    fun queuedOfflineSamplesCount(): Int = offlineLocationQueue.size

    fun attemptDeliveryCompletionWithOtp(
        providedOtp: String,
        expectedOtp: String
    ): Result<CourierDeliveryStage> {
        if (!isNetworkOnline) {
            // Never mark delivery as completed locally while offline (M11 invariant)
            return Result.failure(IllegalStateException("OFFLINE_COMPLETION_BLOCKED"))
        }
        if (!providedOtp.matches(Regex("^\\d{4}$")) || providedOtp != expectedOtp) {
            return Result.failure(IllegalArgumentException("DELIVERY_INVALID_OTP_CODE"))
        }
        stage = CourierDeliveryStage.DELIVERED_CONFIRMED
        return Result.success(stage)
    }
}
