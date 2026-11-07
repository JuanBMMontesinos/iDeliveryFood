import XCTest
@testable import CustomerApp

final class CustomerSwiftUIViewsTests: XCTestCase {
    func testDeepLinkResolutionSingleStoreBasketAndCheckoutReadiness() {
        XCTAssertEqual(
            CustomerRootView.resolveDeepLink("ideliveryfood-customer://auth-callback?code=abc"),
            .discovery
        )
        XCTAssertEqual(
            CustomerRootView.resolveDeepLink("ideliveryfood-customer://stores/paulista-grill-jardins"),
            .storeDetail(storeId: "paulista-grill-jardins")
        )
        XCTAssertEqual(
            CustomerRootView.resolveDeepLink("ideliveryfood://orders/70000000-0000-4000-8000-000000000001"),
            .orderTracking(orderId: "70000000-0000-4000-8000-000000000001")
        )
        XCTAssertNil(CustomerRootView.resolveDeepLink("https://evil.example.com/orders/123"))

        let controller = CustomerMarketplaceController(locale: "pt-BR")
        XCTAssertTrue(controller.formatBrlCents(4590).contains("45"))

        let first = controller.addItemToBasket(
            targetStoreId: "store-1",
            item: MobileCartItem(productId: "prod-1", quantity: 1),
            confirmStoreSwitch: false
        )
        XCTAssertTrue(first.allowed)

        let conflict = controller.addItemToBasket(
            targetStoreId: "store-2",
            item: MobileCartItem(productId: "prod-2", quantity: 1),
            confirmStoreSwitch: false
        )
        XCTAssertFalse(conflict.allowed)
        XCTAssertTrue(conflict.requiresStoreSwitchConfirmation)

        let readiness = controller.evaluateCheckoutReadiness(
            pspStatus: "BLOCKED_MISSING_CREDENTIALS",
            missingEnvVars: ["MERCADOPAGO_ACCESS_TOKEN"]
        )
        XCTAssertFalse(readiness.canSubmitOrder)
        XCTAssertEqual(readiness.bannerMessageKey, "checkout_psp_blocked_notice")
    }
}
