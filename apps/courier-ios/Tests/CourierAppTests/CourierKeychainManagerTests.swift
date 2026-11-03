import XCTest
@testable import CourierApp

final class CourierKeychainManagerTests: XCTestCase {
    func testCourierApprovalGuardAndLocale() {
        let manager = CourierKeychainManager()
        XCTAssertEqual(manager.preferredLocale(), "en")
        XCTAssertFalse(manager.canGoOnlineForDispatch(approvalStatus: "PENDING_APPROVAL"))
        XCTAssertTrue(manager.canGoOnlineForDispatch(approvalStatus: "APPROVED"))
        XCTAssertEqual(manager.setPreferredLocale("pt-BR"), "pt-BR")
        XCTAssertTrue(manager.isAllowedDeepLink("ideliveryfood-courier://auth-callback?code=abc"))
    }
}
