import Foundation

public struct CustomerAddressDto: Equatable, Codable {
    public let id: String
    public let label: String
    public let recipientName: String
    public let streetLine: String
    public let number: String
    public let complement: String?
    public let neighborhood: String
    public let city: String
    public let stateCode: String
    public let postalCode: String
    public let latitude: Double
    public let longitude: Double
    public let isDefault: Bool

    public init(
        id: String,
        label: String,
        recipientName: String,
        streetLine: String,
        number: String,
        complement: String?,
        neighborhood: String,
        city: String,
        stateCode: String,
        postalCode: String,
        latitude: Double,
        longitude: Double,
        isDefault: Bool
    ) {
        self.id = id
        self.label = label
        self.recipientName = recipientName
        self.streetLine = streetLine
        self.number = number
        self.complement = complement
        self.neighborhood = neighborhood
        self.city = city
        self.stateCode = stateCode
        self.postalCode = postalCode
        self.latitude = latitude
        self.longitude = longitude
        self.isDefault = isDefault
    }
}

public struct CustomerCatalogOptionDto: Equatable, Codable {
    public let id: String
    public let localizedName: String
    public let additionalPriceCents: Int
    public let isAvailable: Bool

    public init(id: String, localizedName: String, additionalPriceCents: Int, isAvailable: Bool) {
        self.id = id
        self.localizedName = localizedName
        self.additionalPriceCents = additionalPriceCents
        self.isAvailable = isAvailable
    }
}

public struct CustomerCatalogOptionGroupDto: Equatable, Codable {
    public let id: String
    public let localizedName: String
    public let minSelections: Int
    public let maxSelections: Int
    public let options: [CustomerCatalogOptionDto]

    public init(
        id: String,
        localizedName: String,
        minSelections: Int,
        maxSelections: Int,
        options: [CustomerCatalogOptionDto]
    ) {
        self.id = id
        self.localizedName = localizedName
        self.minSelections = minSelections
        self.maxSelections = maxSelections
        self.options = options
    }
}

public struct CustomerCatalogProductDto: Equatable, Codable {
    public let id: String
    public let storeId: String
    public let categoryId: String
    public let localizedName: String
    public let localizedDescription: String
    public let priceCents: Int
    public let isAvailable: Bool
    public let optionGroups: [CustomerCatalogOptionGroupDto]

    public init(
        id: String,
        storeId: String,
        categoryId: String,
        localizedName: String,
        localizedDescription: String,
        priceCents: Int,
        isAvailable: Bool,
        optionGroups: [CustomerCatalogOptionGroupDto]
    ) {
        self.id = id
        self.storeId = storeId
        self.categoryId = categoryId
        self.localizedName = localizedName
        self.localizedDescription = localizedDescription
        self.priceCents = priceCents
        self.isAvailable = isAvailable
        self.optionGroups = optionGroups
    }
}

public struct CustomerStoreDetailDto: Equatable, Codable {
    public let store: MobilePublishedStore
    public let products: [CustomerCatalogProductDto]

    public init(store: MobilePublishedStore, products: [CustomerCatalogProductDto]) {
        self.store = store
        self.products = products
    }
}

public struct ServerQuoteDto: Equatable, Codable {
    public let id: String
    public let storeId: String
    public let subtotalCents: Int
    public let addonsCents: Int
    public let serviceFeeCents: Int
    public let deliveryFeeCents: Int
    public let discountCents: Int
    public let totalCents: Int
    public let expiresAtIso: String

    public init(
        id: String,
        storeId: String,
        subtotalCents: Int,
        addonsCents: Int,
        serviceFeeCents: Int,
        deliveryFeeCents: Int,
        discountCents: Int,
        totalCents: Int,
        expiresAtIso: String
    ) {
        self.id = id
        self.storeId = storeId
        self.subtotalCents = subtotalCents
        self.addonsCents = addonsCents
        self.serviceFeeCents = serviceFeeCents
        self.deliveryFeeCents = deliveryFeeCents
        self.discountCents = discountCents
        self.totalCents = totalCents
        self.expiresAtIso = expiresAtIso
    }
}

public struct CustomerOrderDto: Equatable, Codable {
    public let id: String
    public let orderNumber: Int
    public let storeId: String
    public let orderStatus: String
    public let paymentStatus: String
    public let deliveryStatus: String
    public let totalCents: Int
    public let createdAtIso: String

    public init(
        id: String,
        orderNumber: Int,
        storeId: String,
        orderStatus: String,
        paymentStatus: String,
        deliveryStatus: String,
        totalCents: Int,
        createdAtIso: String
    ) {
        self.id = id
        self.orderNumber = orderNumber
        self.storeId = storeId
        self.orderStatus = orderStatus
        self.paymentStatus = paymentStatus
        self.deliveryStatus = deliveryStatus
        self.totalCents = totalCents
        self.createdAtIso = createdAtIso
    }
}

public struct CustomerHttpRequest: Equatable {
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

public struct CustomerHttpResponse: Equatable {
    public let statusCode: Int
    public let body: String
    public let correlationId: String?

    public init(statusCode: Int, body: String, correlationId: String?) {
        self.statusCode = statusCode
        self.body = body
        self.correlationId = correlationId
    }
}

public protocol CustomerHttpTransport {
    func execute(_ request: CustomerHttpRequest) -> CustomerHttpResponse
}

public final class UrlSessionHttpTransport: CustomerHttpTransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func execute(_ request: CustomerHttpRequest) -> CustomerHttpResponse {
        guard let url = URL(string: request.url) else {
            return CustomerHttpResponse(statusCode: 400, body: "{\"error\":{\"code\":\"INVALID_URL\"}}", correlationId: nil)
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
        var capturedResponse = CustomerHttpResponse(statusCode: 503, body: "", correlationId: nil)

        let task = session.dataTask(with: urlRequest) { data, response, _ in
            let httpResponse = response as? HTTPURLResponse
            let statusCode = httpResponse?.statusCode ?? 503
            let bodyText = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let corrId = httpResponse?.value(forHTTPHeaderField: "x-correlation-id")
            capturedResponse = CustomerHttpResponse(statusCode: statusCode, body: bodyText, correlationId: corrId)
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 15.0)
        return capturedResponse
    }
}

/// Native iOS HTTP Client for iDeliveryFood /v1 API (M06).
/// Propagates Bearer token from KeychainSessionVault, Accept-Language ('en' or 'pt-BR'),
/// X-Correlation-Id, and X-Idempotency-Key. Zero mocked or hardcoded records.
public final class CustomerApiClient {
    private let normalizedBaseUrl: String
    private let sessionVault: KeychainSessionVault
    private let transport: CustomerHttpTransport

    public init(
        baseUrl: String,
        sessionVault: KeychainSessionVault,
        transport: CustomerHttpTransport = UrlSessionHttpTransport()
    ) {
        let trimmed = baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.normalizedBaseUrl = trimmed.hasSuffix("/v1") ? trimmed : "\(trimmed)/v1"
        self.sessionVault = sessionVault
        self.transport = transport
    }

    public func buildHeaders(
        idempotencyKey: String? = nil,
        correlationId: String = "ios_\(UUID().uuidString.lowercased())"
    ) -> [String: String] {
        var headers: [String: String] = [
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Accept-Language": sessionVault.preferredLocale(),
            "X-Correlation-Id": correlationId
        ]
        if let token = sessionVault.accessToken() {
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

    public func fetchPublishedStores() -> CustomerHttpResponse {
        let locale = sessionVault.preferredLocale()
        return transport.execute(
            CustomerHttpRequest(
                method: "GET",
                url: "\(normalizedBaseUrl)/stores?locale=\(locale)",
                headers: buildHeaders()
            )
        )
    }

    public func fetchStoreDetail(storeIdOrSlug: String) -> CustomerHttpResponse {
        let locale = sessionVault.preferredLocale()
        return transport.execute(
            CustomerHttpRequest(
                method: "GET",
                url: "\(normalizedBaseUrl)/stores/\(storeIdOrSlug)?locale=\(locale)",
                headers: buildHeaders()
            )
        )
    }

    public func fetchMyProfile() -> CustomerHttpResponse {
        return transport.execute(
            CustomerHttpRequest(
                method: "GET",
                url: "\(normalizedBaseUrl)/me",
                headers: buildHeaders()
            )
        )
    }

    public func fetchMyAddresses() -> CustomerHttpResponse {
        return transport.execute(
            CustomerHttpRequest(
                method: "GET",
                url: "\(normalizedBaseUrl)/me/addresses",
                headers: buildHeaders()
            )
        )
    }

    public func createMyAddress(addressJson: String) -> CustomerHttpResponse {
        return transport.execute(
            CustomerHttpRequest(
                method: "POST",
                url: "\(normalizedBaseUrl)/me/addresses",
                headers: buildHeaders(),
                bodyJson: addressJson
            )
        )
    }

    public func createServerQuote(
        storeId: String,
        addressId: String,
        fulfillmentModality: String,
        items: [MobileCartItem],
        promotionCode: String? = nil,
        idempotencyKey: String
    ) -> CustomerHttpResponse {
        let itemsJson = items.map {
            "{\"productId\":\"\($0.productId)\",\"quantity\":\($0.quantity),\"selectedOptions\":[]}"
        }.joined(separator: ",")
        let promoField = promotionCode.map { "\"promotionCode\":\"\($0)\"," } ?? ""
        let body = "{\"storeId\":\"\(storeId)\",\"addressId\":\"\(addressId)\",\"fulfillmentModality\":\"\(fulfillmentModality)\",\(promoField)\"items\":[\(itemsJson)]}"
        return transport.execute(
            CustomerHttpRequest(
                method: "POST",
                url: "\(normalizedBaseUrl)/quotes",
                headers: buildHeaders(idempotencyKey: idempotencyKey),
                bodyJson: body
            )
        )
    }

    public func createOrderFromQuote(
        quoteId: String,
        customerNotes: String?,
        idempotencyKey: String
    ) -> CustomerHttpResponse {
        let notesField = customerNotes.map { "\"customerNotes\":\"\($0)\"" } ?? "\"customerNotes\":null"
        let body = "{\"quoteId\":\"\(quoteId)\",\(notesField)}"
        return transport.execute(
            CustomerHttpRequest(
                method: "POST",
                url: "\(normalizedBaseUrl)/orders",
                headers: buildHeaders(idempotencyKey: idempotencyKey),
                bodyJson: body
            )
        )
    }

    public func fetchOrder(orderId: String) -> CustomerHttpResponse {
        return transport.execute(
            CustomerHttpRequest(
                method: "GET",
                url: "\(normalizedBaseUrl)/orders/\(orderId)",
                headers: buildHeaders()
            )
        )
    }

    public func submitOrderReview(orderId: String, rating: Int, comment: String?) -> CustomerHttpResponse {
        precondition((1...5).contains(rating), "Rating must be between 1 and 5.")
        let commentJson = comment.map { "\"\($0)\"" } ?? "null"
        return transport.execute(
            CustomerHttpRequest(
                method: "POST",
                url: "\(normalizedBaseUrl)/orders/\(orderId)/review",
                headers: buildHeaders(),
                bodyJson: "{\"rating\":\(rating),\"comment\":\(commentJson)}"
            )
        )
    }

    public func createSupportCase(
        orderId: String,
        subject: String,
        category: String = "ORDER_ISSUE"
    ) -> CustomerHttpResponse {
        let trimmed = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        precondition(!trimmed.isEmpty, "Support ticket subject is required.")
        return transport.execute(
            CustomerHttpRequest(
                method: "POST",
                url: "\(normalizedBaseUrl)/orders/\(orderId)/support-cases",
                headers: buildHeaders(),
                bodyJson: "{\"subject\":\"\(trimmed)\",\"category\":\"\(category)\",\"priority\":\"MEDIUM\"}"
            )
        )
    }

    public func fetchMyDevices() -> CustomerHttpResponse {
        return transport.execute(
            CustomerHttpRequest(
                method: "GET",
                url: "\(normalizedBaseUrl)/me/devices",
                headers: buildHeaders()
            )
        )
    }

    public func revokeDevice(deviceId: String) -> CustomerHttpResponse {
        return transport.execute(
            CustomerHttpRequest(
                method: "POST",
                url: "\(normalizedBaseUrl)/me/devices/revoke",
                headers: buildHeaders(),
                bodyJson: "{\"deviceId\":\"\(deviceId)\"}"
            )
        )
    }

    public func requestAccountDeletion(
        hasActiveOrders: Bool,
        hasOpenFinancialDisputes: Bool,
        hasCompletedFiscalTransactions: Bool,
        reason: String
    ) -> CustomerHttpResponse {
        let body = "{\"hasActiveOrders\":\(hasActiveOrders),\"hasOpenFinancialDisputes\":\(hasOpenFinancialDisputes),\"hasCompletedFiscalTransactions\":\(hasCompletedFiscalTransactions),\"reason\":\"\(reason)\"}"
        return transport.execute(
            CustomerHttpRequest(
                method: "POST",
                url: "\(normalizedBaseUrl)/me/privacy-requests",
                headers: buildHeaders(),
                bodyJson: body
            )
        )
    }
}
