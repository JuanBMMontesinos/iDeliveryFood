import XCTest
@testable import CustomerApp

final class KeychainSessionVaultTests: XCTestCase {
    func testSessionLifecycleLocaleAndDeepLinkAllowlist() {
        let vault = KeychainSessionVault()
        XCTAssertEqual(vault.preferredLocale(), "en")
        XCTAssertEqual(vault.setPreferredLocale("pt-BR"), "pt-BR")

        vault.saveTokens(accessToken: "jwt_access", refreshToken: "jwt_refresh")
        XCTAssertEqual(vault.accessToken(), "jwt_access")
        vault.revokeSession()
        XCTAssertNil(vault.accessToken())

        XCTAssertTrue(vault.isAllowedDeepLink("ideliveryfood-customer://auth-callback?code=123"))
        XCTAssertFalse(vault.isAllowedDeepLink("https://evil.example.com/callback"))
    }
}
