import Foundation

public struct CourierProfileDto: Equatable, Codable, Sendable {
    public let courierId: String
    public let displayName: String
    public let vehicleModality: String
    public let approvalStatus: String
    public let isAvailableOnline: Bool

    public init(
        courierId: String,
        displayName: String,
        vehicleModality: String,
        approvalStatus: String,
        isAvailableOnline: Bool
    ) {
        self.courierId = courierId
        self.displayName = displayName
        self.vehicleModality = vehicleModality
        self.approvalStatus = approvalStatus
        self.isAvailableOnline = isAvailableOnline
    }
}

public struct CourierSettlementDto: Equatable, Codable, Sendable {
    public let settlementId: String
    public let beneficiaryId: String
    public let periodStartIso: String
    public let periodEndIso: String
    public let grossCents: Int
    public let platformFeeCents: Int
    public let netPayoutCents: Int
    public let payoutStatus: String

    public init(
        settlementId: String,
        beneficiaryId: String,
        periodStartIso: String,
        periodEndIso: String,
        grossCents: Int,
        platformFeeCents: Int,
        netPayoutCents: Int,
        payoutStatus: String
    ) {
        self.settlementId = settlementId
        self.beneficiaryId = beneficiaryId
        self.periodStartIso = periodStartIso
        self.periodEndIso = periodEndIso
        self.grossCents = grossCents
        self.platformFeeCents = platformFeeCents
        self.netPayoutCents = netPayoutCents
        self.payoutStatus = payoutStatus
    }
}

public struct CourierHttpRequest: Equatable {
    public let method: String
    public let url: String
    public let headers: [String: String]
    public let bodyJson: String?

    public init(method: String, url: String, headers: [String: String], bodyJson: String? = nil) {
        self.method = method
        self.url = url
        self.headers = headers
        self.bodyJson = bodyJson
    }
}

public struct CourierHttpResponse: Equatable {
    public let statusCode: Int
    public let body: String
    public let correlationId: String?

    public init(statusCode: Int, body: String, correlationId: String?) {
        self.statusCode = statusCode
        self.body = body
        self.correlationId = correlationId
    }
}

public protocol CourierHttpTransport {
    func execute(_ request: CourierHttpRequest) -> CourierHttpResponse
}

public final class UrlSessionCourierHttpTransport: CourierHttpTransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func execute(_ request: CourierHttpRequest) -> CourierHttpResponse {
        guard let url = URL(string: request.url) else {
            return CourierHttpResponse(
                statusCode: 400,
                body: "{\"error\":{\"code\":\"INVALID_URL\"}}",
                correlationId: nil
            )
        }
        var urlRequest = URLRequest(url: url, timeoutInterval: 15.0)
        urlRequest.httpMethod = request.method
        for (key, value) in request.headers {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        if let bodyJson = request.bodyJson {
            urlRequest.httpBody = bodyJson.data(using: .utf8)
        }

        let semaphore = DispatchSemaphore(value: 0)
        var capturedResponse = CourierHttpResponse(statusCode: 503, body: "", correlationId: nil)

        let task = session.dataTask(with: urlRequest) { data, response, _ in
            let httpResponse = response as? HTTPURLResponse
            let statusCode = httpResponse?.statusCode ?? 503
            let bodyText = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let corrId = httpResponse?.value(forHTTPHeaderField: "x-correlation-id")
            capturedResponse = CourierHttpResponse(
                statusCode: statusCode,
                body: bodyText,
                correlationId: corrId
            )
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 15.0)
        return capturedResponse
    }
}

/// Native iOS HTTP Client & Offline Location Queue Synchronizer for iDeliveryFood Courier App (M11).
/// Propagates Bearer token from CourierKeychainManager, Accept-Language ('en' or 'pt-BR'),
/// X-Correlation-Id, and X-Idempotency-Key. Zero mocked or hardcoded records.
public final class CourierApiClient {
    private let normalizedBaseUrl: String
    private let keychainManager: CourierKeychainManager
    private let transport: CourierHttpTransport

    public init(
        baseUrl: String,
        keychainManager: CourierKeychainManager,
        transport: CourierHttpTransport = UrlSessionCourierHttpTransport()
    ) {
        let trimmed = baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.normalizedBaseUrl = trimmed.hasSuffix("/v1") ? trimmed : "\(trimmed)/v1"
        self.keychainManager = keychainManager
        self.transport = transport
    }

    public func buildHeaders(
        idempotencyKey: String? = nil,
        correlationId: String = "courier_ios_\(UUID().uuidString.lowercased())"
    ) -> [String: String] {
        var headers: [String: String] = [
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Accept-Language": keychainManager.preferredLocale(),
            "X-Correlation-Id": correlationId
        ]
        if let token = keychainManager.accessToken() {
            headers["Authorization"] = "Bearer \(token)"
        }
        if let idempotencyKey = idempotencyKey {
            let trimmedKey = idempotencyKey.trimmingCharacters(in: .whitespacesAndNewlines)
            precondition(
                trimmedKey.count >= 8,
                "IDEMPOTENCY_KEY_REQUIRED: X-Idempotency-Key must be at least 8 characters."
            )
            headers["X-Idempotency-Key"] = trimmedKey
        }
        return headers
    }

    public func submitOnboardingDocuments(
        courierId: String,
        vehicleModality: String,
        documentNumber: String
    ) -> CourierHttpResponse {
        let trimmed = documentNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        precondition(!trimmed.isEmpty, "Document number is required for KYC onboarding.")
        let body = "{\"courierId\":\"\(courierId)\",\"vehicleModality\":\"\(vehicleModality)\",\"documentNumber\":\"\(trimmed)\"}"
        return transport.execute(
            CourierHttpRequest(
                method: "POST",
                url: "\(normalizedBaseUrl)/courier/onboarding",
                headers: buildHeaders(),
                bodyJson: body
            )
        )
    }

    public func fetchLogisticsOverview() -> CourierHttpResponse {
        return transport.execute(
            CourierHttpRequest(
                method: "GET",
                url: "\(normalizedBaseUrl)/logistics/overview",
                headers: buildHeaders()
            )
        )
    }

    public func acceptDeliveryOffer(
        offerId: String,
        courierId: String,
        idempotencyKey: String
    ) -> CourierHttpResponse {
        return transport.execute(
            CourierHttpRequest(
                method: "POST",
                url: "\(normalizedBaseUrl)/logistics/offers/\(offerId)/accept",
                headers: buildHeaders(idempotencyKey: idempotencyKey),
                bodyJson: "{\"courierId\":\"\(courierId)\"}"
            )
        )
    }

    public func rejectDeliveryOffer(
        offerId: String,
        courierId: String,
        reason: String
    ) -> CourierHttpResponse {
        return transport.execute(
            CourierHttpRequest(
                method: "POST",
                url: "\(normalizedBaseUrl)/logistics/offers/\(offerId)/reject",
                headers: buildHeaders(),
                bodyJson: "{\"courierId\":\"\(courierId)\",\"reason\":\"\(reason)\"}"
            )
        )
    }

    public func confirmPickupAtStore(
        taskId: String,
        courierId: String,
        idempotencyKey: String
    ) -> CourierHttpResponse {
        return transport.execute(
            CourierHttpRequest(
                method: "POST",
                url: "\(normalizedBaseUrl)/logistics/tasks/\(taskId)/pickup",
                headers: buildHeaders(idempotencyKey: idempotencyKey),
                bodyJson: "{\"courierId\":\"\(courierId)\"}"
            )
        )
    }

    public func syncQueuedLocationSamples(
        courierId: String,
        samples: [CourierLocationQueueSample]
    ) -> [CourierHttpResponse] {
        return samples.map { sample in
            let taskField = sample.deliveryTaskId.map { "\"\($0)\"" } ?? "null"
            let body = "{\"deliveryTaskId\":\(taskField),\"latitude\":\(sample.latitude),\"longitude\":\(sample.longitude),\"accuracyMeters\":\(sample.accuracyMeters),\"recordedAtEpochSeconds\":\(sample.recordedAtEpochSeconds)}"
            return transport.execute(
                CourierHttpRequest(
                    method: "POST",
                    url: "\(normalizedBaseUrl)/logistics/couriers/\(courierId)/location",
                    headers: buildHeaders(),
                    bodyJson: body
                )
            )
        }
    }

    public func completeDeliveryWithOtp(
        taskId: String,
        courierId: String,
        providedOtp: String,
        idempotencyKey: String
    ) -> CourierHttpResponse {
        precondition(
            providedOtp.count == 4 && providedOtp.allSatisfy({ $0.isNumber }),
            "DELIVERY_INVALID_OTP_CODE: 4-digit OTP code is required."
        )
        return transport.execute(
            CourierHttpRequest(
                method: "POST",
                url: "\(normalizedBaseUrl)/logistics/tasks/\(taskId)/complete-otp",
                headers: buildHeaders(idempotencyKey: idempotencyKey),
                bodyJson: "{\"courierId\":\"\(courierId)\",\"otpCode\":\"\(providedOtp)\"}"
            )
        )
    }

    public func reportDeliveryIncident(
        taskId: String,
        courierId: String,
        category: String,
        description: String
    ) -> CourierHttpResponse {
        let trimmed = description.trimmingCharacters(in: .whitespacesAndNewlines)
        precondition(!trimmed.isEmpty, "Incident description is required.")
        return transport.execute(
            CourierHttpRequest(
                method: "POST",
                url: "\(normalizedBaseUrl)/logistics/tasks/\(taskId)/incidents",
                headers: buildHeaders(),
                bodyJson: "{\"courierId\":\"\(courierId)\",\"category\":\"\(category)\",\"description\":\"\(trimmed)\"}"
            )
        )
    }

    public func fetchCourierSettlements(courierId: String) -> CourierHttpResponse {
        return transport.execute(
            CourierHttpRequest(
                method: "GET",
                url: "\(normalizedBaseUrl)/finance/settlements?beneficiaryType=COURIER&beneficiaryId=\(courierId)",
                headers: buildHeaders()
            )
        )
    }
}
