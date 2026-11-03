import Foundation

public struct CourierOfferCardModel: Equatable, Sendable {
    public let offerId: String
    public let deliveryTaskId: String
    public let pickupStoreName: String
    public let distanceMeters: Int
    public let offeredFeeCents: Int
    public let dropoffNeighborhoodOnly: String
    public let fullCustomerAddress: String?
    public let expiresAtEpochSeconds: Int64

    public init(
        offerId: String,
        deliveryTaskId: String,
        pickupStoreName: String,
        distanceMeters: Int,
        offeredFeeCents: Int,
        dropoffNeighborhoodOnly: String,
        fullCustomerAddress: String?,
        expiresAtEpochSeconds: Int64
    ) {
        self.offerId = offerId
        self.deliveryTaskId = deliveryTaskId
        self.pickupStoreName = pickupStoreName
        self.distanceMeters = distanceMeters
        self.offeredFeeCents = offeredFeeCents
        self.dropoffNeighborhoodOnly = dropoffNeighborhoodOnly
        self.fullCustomerAddress = fullCustomerAddress
        self.expiresAtEpochSeconds = expiresAtEpochSeconds
    }
}

public enum CourierDeliveryStage: String, Equatable, Sendable {
    case idle = "IDLE"
    case offerRinging = "OFFER_RINGING"
    case assignedEnRouteToStore = "ASSIGNED_EN_ROUTE_TO_STORE"
    case pickedUpEnRouteToCustomer = "PICKED_UP_EN_ROUTE_TO_CUSTOMER"
    case deliveredConfirmed = "DELIVERED_CONFIRMED"
}

public enum CourierDispatchError: Error, Equatable {
    case courierOffline
    case noActiveOffer
    case offerExpired
    case offlineCompletionBlocked
    case invalidOtpCode
}

/// Native Swift State & Dispatch Controller for the iDeliveryFood Courier iOS App (M11).
public final class CourierDispatchController {
    public let courierId: String
    public private(set) var selectedLocale: String
    public private(set) var isOnline: Bool = false
    public private(set) var isGpsAuthorized: Bool = true
    public private(set) var isNetworkOnline: Bool = true
    public private(set) var stage: CourierDeliveryStage = .idle
    public private(set) var currentOffer: CourierOfferCardModel?

    public init(courierId: String, initialLocale: String = "en") {
        self.courierId = courierId
        self.selectedLocale = initialLocale == "pt-BR" ? "pt-BR" : "en"
    }

    @discardableResult
    public func switchLocale(_ newLocale: String) -> String {
        selectedLocale = newLocale == "pt-BR" ? "pt-BR" : "en"
        return selectedLocale
    }

    public func setOnlineAvailability(online: Bool, gpsAuthorized: Bool) {
        self.isGpsAuthorized = gpsAuthorized
        self.isOnline = online && gpsAuthorized
    }

    public func setNetworkConnectivity(online: Bool) {
        self.isNetworkOnline = online
    }

    public func gpsWarningBannerKey() -> String? {
        return isGpsAuthorized ? nil : "courier_gps_permission_denied_notice"
    }

    public func receiveDispatchOffer(_ offer: CourierOfferCardModel) throws {
        guard isOnline else { throw CourierDispatchError.courierOffline }
        currentOffer = CourierOfferCardModel(
            offerId: offer.offerId,
            deliveryTaskId: offer.deliveryTaskId,
            pickupStoreName: offer.pickupStoreName,
            distanceMeters: offer.distanceMeters,
            offeredFeeCents: offer.offeredFeeCents,
            dropoffNeighborhoodOnly: offer.dropoffNeighborhoodOnly,
            fullCustomerAddress: nil, // Hidden until accepted!
            expiresAtEpochSeconds: offer.expiresAtEpochSeconds
        )
        stage = .offerRinging
    }

    public func acceptCurrentOffer(
        nowEpochSeconds: Int64,
        serverRevealedFullAddress: String
    ) throws -> CourierOfferCardModel {
        guard isOnline else { throw CourierDispatchError.courierOffline }
        guard let offer = currentOffer else { throw CourierDispatchError.noActiveOffer }
        guard nowEpochSeconds < offer.expiresAtEpochSeconds else {
            throw CourierDispatchError.offerExpired
        }

        let accepted = CourierOfferCardModel(
            offerId: offer.offerId,
            deliveryTaskId: offer.deliveryTaskId,
            pickupStoreName: offer.pickupStoreName,
            distanceMeters: offer.distanceMeters,
            offeredFeeCents: offer.offeredFeeCents,
            dropoffNeighborhoodOnly: offer.dropoffNeighborhoodOnly,
            fullCustomerAddress: serverRevealedFullAddress,
            expiresAtEpochSeconds: offer.expiresAtEpochSeconds
        )
        currentOffer = accepted
        stage = .assignedEnRouteToStore
        return accepted
    }

    public func completeDeliveryWithOtp(
        providedOtp: String,
        expectedOtp: String
    ) throws -> CourierDeliveryStage {
        guard isNetworkOnline else {
            throw CourierDispatchError.offlineCompletionBlocked
        }
        guard providedOtp.count == 4, providedOtp == expectedOtp else {
            throw CourierDispatchError.invalidOtpCode
        }
        stage = .deliveredConfirmed
        return stage
    }
}
