import XCTest
@testable import CourierApp

final class CourierDispatchControllerTests: XCTestCase {
    func testAddressPrivacyBeforeAndAfterOfferAcceptance() throws {
        let controller = CourierDispatchController(courierId: "courier_01", initialLocale: "en")
        controller.setOnlineAvailability(online: true, gpsAuthorized: true)

        try controller.receiveDispatchOffer(
            CourierOfferCardModel(
                offerId: "off_1",
                deliveryTaskId: "task_1",
                pickupStoreName: "Paulista Artisan Burger",
                distanceMeters: 1420,
                offeredFeeCents: 850,
                dropoffNeighborhoodOnly: "Bela Vista",
                fullCustomerAddress: "SHOULD_BE_HIDDEN",
                expiresAtEpochSeconds: 2000
            )
        )

        XCTAssertNil(controller.currentOffer?.fullCustomerAddress)
        let accepted = try controller.acceptCurrentOffer(
            nowEpochSeconds: 1500,
            serverRevealedFullAddress: "Av. Paulista, 1578 - Apt 42, Bela Vista"
        )
        XCTAssertEqual(accepted.fullCustomerAddress, "Av. Paulista, 1578 - Apt 42, Bela Vista")
        XCTAssertEqual(controller.stage, .assignedEnRouteToStore)
    }

    func testBlocksOfflineCompletionAndValidatesOtp() throws {
        let controller = CourierDispatchController(courierId: "courier_01", initialLocale: "pt-BR")
        controller.setOnlineAvailability(online: true, gpsAuthorized: true)
        controller.setNetworkConnectivity(online: false)

        XCTAssertThrowsError(try controller.completeDeliveryWithOtp(providedOtp: "4829", expectedOtp: "4829")) { error in
            XCTAssertEqual(error as? CourierDispatchError, .offlineCompletionBlocked)
        }

        controller.setNetworkConnectivity(online: true)
        let stage = try controller.completeDeliveryWithOtp(providedOtp: "4829", expectedOtp: "4829")
        XCTAssertEqual(stage, .deliveredConfirmed)
    }
}
