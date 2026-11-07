package com.ideliveryfood.customer.network

import com.ideliveryfood.customer.marketplace.MobileCartItem
import com.ideliveryfood.customer.marketplace.MobilePublishedStore
import com.ideliveryfood.customer.security.SecureSessionStore
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URI
import java.util.UUID

data class CustomerAddressDto(
    val id: String,
    val label: String,
    val recipientName: String,
    val streetLine: String,
    val number: String,
    val complement: String?,
    val neighborhood: String,
    val city: String,
    val stateCode: String,
    val postalCode: String,
    val latitude: Double,
    val longitude: Double,
    val isDefault: Boolean
)

data class CustomerCatalogOptionDto(
    val id: String,
    val localizedName: String,
    val additionalPriceCents: Int,
    val isAvailable: Boolean
)

data class CustomerCatalogOptionGroupDto(
    val id: String,
    val localizedName: String,
    val minSelections: Int,
    val maxSelections: Int,
    val options: List<CustomerCatalogOptionDto>
)

data class CustomerCatalogProductDto(
    val id: String,
    val storeId: String,
    val categoryId: String,
    val localizedName: String,
    val localizedDescription: String,
    val priceCents: Int,
    val isAvailable: Boolean,
    val optionGroups: List<CustomerCatalogOptionGroupDto>
)

data class CustomerStoreDetailDto(
    val store: MobilePublishedStore,
    val products: List<CustomerCatalogProductDto>
)

data class ServerQuoteDto(
    val id: String,
    val storeId: String,
    val subtotalCents: Int,
    val addonsCents: Int,
    val serviceFeeCents: Int,
    val deliveryFeeCents: Int,
    val discountCents: Int,
    val totalCents: Int,
    val expiresAtIso: String
)

data class CustomerOrderDto(
    val id: String,
    val orderNumber: Int,
    val storeId: String,
    val orderStatus: String,
    val paymentStatus: String,
    val deliveryStatus: String,
    val totalCents: Int,
    val createdAtIso: String
)

data class CustomerHttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val bodyJson: String? = null
)

data class CustomerHttpResponse(
    val statusCode: Int,
    val body: String,
    val correlationId: String?
)

interface CustomerHttpTransport {
    fun execute(request: CustomerHttpRequest): CustomerHttpResponse
}

class UrlConnectionHttpTransport : CustomerHttpTransport {
    override fun execute(request: CustomerHttpRequest): CustomerHttpResponse {
        val conn = (URI(request.url).toURL().openConnection() as HttpURLConnection).apply {
            requestMethod = request.method
            connectTimeout = 10_000
            readTimeout = 15_000
            for ((k, v) in request.headers) {
                setRequestProperty(k, v)
            }
        }
        if (request.bodyJson != null) {
            conn.doOutput = true
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(request.bodyJson)
            }
        }
        val status = conn.responseCode
        val stream = if (status in 200..299) conn.inputStream else conn.errorStream
        val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
        val corrId = conn.getHeaderField("x-correlation-id")
        return CustomerHttpResponse(
            statusCode = status,
            body = responseBody,
            correlationId = corrId
        )
    }
}

/**
 * Native Android HTTP Client for iDeliveryFood /v1 API (M06).
 * Propagates Bearer token from SecureSessionStore, Accept-Language ('en' or 'pt-BR'),
 * X-Correlation-Id, and X-Idempotency-Key. Zero mocked or hardcoded records.
 */
class CustomerApiClient(
    baseUrl: String,
    private val sessionStore: SecureSessionStore,
    private val transport: CustomerHttpTransport = UrlConnectionHttpTransport()
) {
    private val normalizedBaseUrl: String = baseUrl.trimEnd('/').let {
        if (it.endsWith("/v1")) it else "$it/v1"
    }

    fun buildHeaders(
        idempotencyKey: String? = null,
        correlationId: String = "android_${UUID.randomUUID()}"
    ): Map<String, String> {
        val headers = linkedMapOf(
            "Accept" to "application/json",
            "Content-Type" to "application/json",
            "Accept-Language" to sessionStore.getPreferredLocale(),
            "X-Correlation-Id" to correlationId
        )
        sessionStore.getAccessToken()?.let { token ->
            headers["Authorization"] = "Bearer $token"
        }
        if (idempotencyKey != null) {
            require(idempotencyKey.trim().length >= 8) {
                "IDEMPOTENCY_KEY_REQUIRED: X-Idempotency-Key must be at least 8 characters."
            }
            headers["X-Idempotency-Key"] = idempotencyKey.trim()
        }
        return headers
    }

    fun fetchPublishedStores(): CustomerHttpResponse {
        val locale = sessionStore.getPreferredLocale()
        return transport.execute(
            CustomerHttpRequest(
                method = "GET",
                url = "$normalizedBaseUrl/stores?locale=$locale",
                headers = buildHeaders()
            )
        )
    }

    fun fetchStoreDetail(storeIdOrSlug: String): CustomerHttpResponse {
        val locale = sessionStore.getPreferredLocale()
        return transport.execute(
            CustomerHttpRequest(
                method = "GET",
                url = "$normalizedBaseUrl/stores/$storeIdOrSlug?locale=$locale",
                headers = buildHeaders()
            )
        )
    }

    fun fetchMyProfile(): CustomerHttpResponse {
        return transport.execute(
            CustomerHttpRequest(
                method = "GET",
                url = "$normalizedBaseUrl/me",
                headers = buildHeaders()
            )
        )
    }

    fun fetchMyAddresses(): CustomerHttpResponse {
        return transport.execute(
            CustomerHttpRequest(
                method = "GET",
                url = "$normalizedBaseUrl/me/addresses",
                headers = buildHeaders()
            )
        )
    }

    fun createMyAddress(addressJson: String): CustomerHttpResponse {
        return transport.execute(
            CustomerHttpRequest(
                method = "POST",
                url = "$normalizedBaseUrl/me/addresses",
                headers = buildHeaders(),
                bodyJson = addressJson
            )
        )
    }

    fun createServerQuote(
        storeId: String,
        addressId: String,
        fulfillmentModality: String,
        items: List<MobileCartItem>,
        promotionCode: String? = null,
        idempotencyKey: String
    ): CustomerHttpResponse {
        val itemsJson = items.joinToString(",") {
            """{"productId":"${it.productId}","quantity":${it.quantity},"selectedOptions":[]}"""
        }
        val promoField = if (promotionCode != null) """"promotionCode":"$promotionCode",""" else ""
        val body = """{"storeId":"$storeId","addressId":"$addressId","fulfillmentModality":"$fulfillmentModality",$promoField"items":[$itemsJson]}"""
        return transport.execute(
            CustomerHttpRequest(
                method = "POST",
                url = "$normalizedBaseUrl/quotes",
                headers = buildHeaders(idempotencyKey = idempotencyKey),
                bodyJson = body
            )
        )
    }

    fun createOrderFromQuote(quoteId: String, customerNotes: String?, idempotencyKey: String): CustomerHttpResponse {
        val notesField = if (customerNotes != null) """"customerNotes":"$customerNotes"""" else """"customerNotes":null"""
        val body = """{"quoteId":"$quoteId",$notesField}"""
        return transport.execute(
            CustomerHttpRequest(
                method = "POST",
                url = "$normalizedBaseUrl/orders",
                headers = buildHeaders(idempotencyKey = idempotencyKey),
                bodyJson = body
            )
        )
    }

    fun fetchOrder(orderId: String): CustomerHttpResponse {
        return transport.execute(
            CustomerHttpRequest(
                method = "GET",
                url = "$normalizedBaseUrl/orders/$orderId",
                headers = buildHeaders()
            )
        )
    }

    fun submitOrderReview(orderId: String, rating: Int, comment: String?): CustomerHttpResponse {
        require(rating in 1..5) { "Rating must be between 1 and 5." }
        val commentJson = if (comment != null) "\"$comment\"" else "null"
        return transport.execute(
            CustomerHttpRequest(
                method = "POST",
                url = "$normalizedBaseUrl/orders/$orderId/review",
                headers = buildHeaders(),
                bodyJson = """{"rating":$rating,"comment":$commentJson}"""
            )
        )
    }

    fun createSupportCase(orderId: String, subject: String, category: String = "ORDER_ISSUE"): CustomerHttpResponse {
        require(subject.isNotBlank()) { "Support ticket subject is required." }
        return transport.execute(
            CustomerHttpRequest(
                method = "POST",
                url = "$normalizedBaseUrl/orders/$orderId/support-cases",
                headers = buildHeaders(),
                bodyJson = """{"subject":"$subject","category":"$category","priority":"MEDIUM"}"""
            )
        )
    }

    fun fetchMyDevices(): CustomerHttpResponse {
        return transport.execute(
            CustomerHttpRequest(
                method = "GET",
                url = "$normalizedBaseUrl/me/devices",
                headers = buildHeaders()
            )
        )
    }

    fun revokeDevice(deviceId: String): CustomerHttpResponse {
        return transport.execute(
            CustomerHttpRequest(
                method = "POST",
                url = "$normalizedBaseUrl/me/devices/revoke",
                headers = buildHeaders(),
                bodyJson = """{"deviceId":"$deviceId"}"""
            )
        )
    }

    fun requestAccountDeletion(
        hasActiveOrders: Boolean,
        hasOpenFinancialDisputes: Boolean,
        hasCompletedFiscalTransactions: Boolean,
        reason: String
    ): CustomerHttpResponse {
        val body = """{"hasActiveOrders":$hasActiveOrders,"hasOpenFinancialDisputes":$hasOpenFinancialDisputes,"hasCompletedFiscalTransactions":$hasCompletedFiscalTransactions,"reason":"$reason"}"""
        return transport.execute(
            CustomerHttpRequest(
                method = "POST",
                url = "$normalizedBaseUrl/me/privacy-requests",
                headers = buildHeaders(),
                bodyJson = body
            )
        )
    }
}
