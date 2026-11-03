import XCTest
@testable import CustomerApp

final class CustomerMarketplaceControllerTests: XCTestCase {
    func testSingleStoreCartOfflineLockAndHonestPspStatus() {
        let controller = CustomerMarketplaceController()
        XCTAssertEqual(controller.currentLocale, "en")

        let first = controller.addItemToBasket(
            targetStoreId: "00000000-0000-4000-8000-000000000201",
            item: MobileCartItem(productId: "prod_601", quantity: 1)
        )
        XCTAssertTrue(first.allowed)
        XCTAssertFalse(first.requiresStoreSwitchConfirmation)

        let crossStore = controller.addItemToBasket(
            targetStoreId: "00000000-0000-4000-8000-000000000202",
            item: MobileCartItem(productId: "prod_603", quantity: 1),
            confirmStoreSwitch: false
        )
        XCTAssertFalse(crossStore.allowed)
        XCTAssertTrue(crossStore.requiresStoreSwitchConfirmation)

        let blockedCheckout = controller.evaluateCheckoutReadiness(
            pspStatus: "BLOCKED_MISSING_CREDENTIALS",
            missingEnvVars: ["STRIPE_SECRET_KEY"]
        )
        XCTAssertFalse(blockedCheckout.canSubmitOrder)
        XCTAssertEqual(blockedCheckout.bannerMessageKey, "checkout_psp_blocked_notice")

        controller.setOfflineMode(true)
        let offlineCheckout = controller.evaluateCheckoutReadiness(
            pspStatus: "SANDBOX_READY",
            missingEnvVars: []
        )
        XCTAssertTrue(offlineCheckout.isOffline)
        XCTAssertTrue(offlineCheckout.isCachedDataStale)
        XCTAssertFalse(offlineCheckout.canSubmitOrder)
        XCTAssertEqual(offlineCheckout.bannerMessageKey, "offline_stale_cache_banner")

        XCTAssertTrue(controller.isAllowedCustomerDeepLink("ideliveryfood-customer://orders/ord_1001"))
        XCTAssertFalse(controller.isAllowedCustomerDeepLink("https://evil.example.com/phish"))
    }
}
