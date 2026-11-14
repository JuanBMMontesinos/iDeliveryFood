import XCTest
@testable import CourierApp

final class CourierSwiftUIViewsTests: XCTestCase {
    func testDeepLinkResolutionOfflineLocationQueueAndDeliveryProgression() throws {
        let keychain = CourierKeychainManager()
        XCTAssertEqual(
            CourierRootView.resolveDeepLink("ideliveryfood-courier://auth-callback?code=123", keychainManager: keychain),
            .availability
        )
        XCTAssertEqual(
            CourierRootView.resolveDeepLink("ideliveryfood-courier://offers/91000000-0000-4000-8000-000000000001", keychainManager: keychain),
            .offerRing(offerId: "91000000-0000-4000-8000-000000000001")
        )
        XCTAssertEqual(
            CourierRootView.resolveDeepLink("ideliveryfood-courier://tasks/90000000-0000-4000-8000-000000000001", keychainManager: keychain),
            .activeDelivery(taskId: "90000000-0000-4000-8000-000000000001")
        )
        XCTAssertNil(
            CourierRootView.resolveDeepLink("https://evil.example.com/offers/123", keychainManager: keychain)
        )

        let controller = CourierDispatchController(courierId: "courier_ios_1", initialLocale: "pt-BR")
        controller.setOnlineAvailability(online: true, gpsAuthorized: true)
        controller.setNetworkConnectivity(online: false)

        let recordedLive = controller.recordLocationSample(
            CourierLocationQueueSample(
                deliveryTaskId: "task_1",
                latitude: -23.56,
                longitude: -46.65,
                accuracyMeters: 4.0,
                recordedAtEpochSeconds: 1730000000
            )
        )
        XCTAssertFalse(recordedLive)
        XCTAssertEqual(controller.queuedOfflineSamplesCount(), 1)
        let drained = controller.drainOfflineLocationQueue()
        XCTAssertEqual(drained.count, 1)
        XCTAssertEqual(controller.queuedOfflineSamplesCount(), 0)

        controller.setNetworkConnectivity(online: true)
        try controller.receiveDispatchOffer(
            CourierOfferCardModel(
                offerId: "off_1",
                deliveryTaskId: "task_1",
                pickupStoreName: "Paulista Artisan Burger",
                distanceMeters: 1500,
                offeredFeeCents: 1200,
                dropoffNeighborhoodOnly: "Bela Vista",
                fullCustomerAddress: "HIDDEN",
                expiresAtEpochSeconds: 2000
            )
        )
        XCTAssertNil(controller.currentOffer?.fullCustomerAddress)

        _ = try controller.acceptCurrentOffer(
            nowEpochSeconds: 1800,
            serverRevealedFullAddress: "Av. Paulista, 1578 - Apto 42"
        )
        _ = try controller.markArrivedAtStore()
        _ = try controller.markPickedUpOrder()
        _ = try controller.markArrivedAtCustomer()
        let finalStage = try controller.completeDeliveryWithOtp(providedOtp: "4829", expectedOtp: "4829")
        XCTAssertEqual(finalStage, .deliveredConfirmed)
    }
}
