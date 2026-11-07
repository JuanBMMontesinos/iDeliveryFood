import XCTest
@testable import CustomerApp

private final class RecordingHttpTransport: CustomerHttpTransport {
    private(set) var requests: [CustomerHttpRequest] = []

    func execute(_ request: CustomerHttpRequest) -> CustomerHttpResponse {
        requests.append(request)
        return CustomerHttpResponse(
            statusCode: 200,
            body: "{\"status\":\"ok\"}",
            correlationId: request.headers["X-Correlation-Id"]
        )
    }
}

final class CustomerApiClientTests: XCTestCase {
    func testPropagatesBearerTokenLocaleCorrelationIdAndIdempotencyKey() {
        let vault = KeychainSessionVault()
        vault.saveTokens(accessToken: "jwt_ios_access_token_123", refreshToken: "jwt_ios_refresh_token_123")
        vault.setPreferredLocale("pt-BR")

        let transport = RecordingHttpTransport()
        let client = CustomerApiClient(
            baseUrl: "https://api.ideliveryfood.local",
            sessionVault: vault,
            transport: transport
        )

        let storesResp = client.fetchPublishedStores()
        XCTAssertEqual(storesResp.statusCode, 200)
        XCTAssertEqual(transport.requests.first?.url, "https://api.ideliveryfood.local/v1/stores?locale=pt-BR")
        XCTAssertEqual(transport.requests.first?.headers["Authorization"], "Bearer jwt_ios_access_token_123")
        XCTAssertEqual(transport.requests.first?.headers["Accept-Language"], "pt-BR")

        let quoteResp = client.createServerQuote(
            storeId: "10000000-0000-4000-8000-000000000001",
            addressId: "30000000-0000-4000-8000-000000000001",
            fulfillmentModality: "PLATFORM_FLEET",
            items: [MobileCartItem(productId: "20000000-0000-4000-8000-000000000011", quantity: 2)],
            promotionCode: "WELCOME10",
            idempotencyKey: "ios_quote_idem_0001"
        )
        XCTAssertEqual(quoteResp.statusCode, 200)
        XCTAssertEqual(transport.requests[1].headers["X-Idempotency-Key"], "ios_quote_idem_0001")
    }
}
