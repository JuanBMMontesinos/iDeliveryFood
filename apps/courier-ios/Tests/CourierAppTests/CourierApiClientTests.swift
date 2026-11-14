import XCTest
@testable import CourierApp

private final class RecordingCourierHttpTransport: CourierHttpTransport {
    private(set) var requests: [CourierHttpRequest] = []

    func execute(_ request: CourierHttpRequest) -> CourierHttpResponse {
        requests.append(request)
        return CourierHttpResponse(
            statusCode: 200,
            body: "{\"status\":\"ok\"}",
            correlationId: request.headers["X-Correlation-Id"]
        )
    }
}

final class CourierApiClientTests: XCTestCase {
    func testPropagatesBearerTokenLocaleCorrelationIdAndIdempotencyKey() {
        let keychain = CourierKeychainManager()
        keychain.saveTokens(accessToken: "jwt_ios_courier_token_001", refreshToken: "jwt_ios_courier_refresh_001")
        keychain.setPreferredLocale("pt-BR")

        let transport = RecordingCourierHttpTransport()
        let client = CourierApiClient(
            baseUrl: "https://api.ideliveryfood.local",
            keychainManager: keychain,
            transport: transport
        )

        let acceptResp = client.acceptDeliveryOffer(
            offerId: "91000000-0000-4000-8000-000000000001",
            courierId: "00000000-0000-4000-8000-000000000041",
            idempotencyKey: "ios_courier_accept_001"
        )
        XCTAssertEqual(acceptResp.statusCode, 200)
        XCTAssertEqual(
            transport.requests.first?.url,
            "https://api.ideliveryfood.local/v1/logistics/offers/91000000-0000-4000-8000-000000000001/accept"
        )
        XCTAssertEqual(transport.requests.first?.headers["Authorization"], "Bearer jwt_ios_courier_token_001")
        XCTAssertEqual(transport.requests.first?.headers["Accept-Language"], "pt-BR")
        XCTAssertEqual(transport.requests.first?.headers["X-Idempotency-Key"], "ios_courier_accept_001")

        let syncResponses = client.syncQueuedLocationSamples(
            courierId: "00000000-0000-4000-8000-000000000041",
            samples: [
                CourierLocationQueueSample(
                    deliveryTaskId: "90000000-0000-4000-8000-000000000001",
                    latitude: -23.5615,
                    longitude: -46.6560,
                    accuracyMeters: 5.5,
                    recordedAtEpochSeconds: 1730000000
                )
            ]
        )
        XCTAssertEqual(syncResponses.count, 1)

        let otpResp = client.completeDeliveryWithOtp(
            taskId: "90000000-0000-4000-8000-000000000001",
            courierId: "00000000-0000-4000-8000-000000000041",
            providedOtp: "4829",
            idempotencyKey: "ios_courier_otp_001"
        )
        XCTAssertEqual(otpResp.statusCode, 200)
    }
}
