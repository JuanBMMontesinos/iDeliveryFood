package com.ideliveryfood.customer.network

import com.ideliveryfood.customer.marketplace.MobileCartItem
import com.ideliveryfood.customer.security.InMemoryEncryptedBackend
import com.ideliveryfood.customer.security.SecureSessionStore

class RecordingHttpTransport : CustomerHttpTransport {
    val recordedRequests = mutableListOf<CustomerHttpRequest>()
    override fun execute(request: CustomerHttpRequest): CustomerHttpResponse {
        recordedRequests.add(request)
        return CustomerHttpResponse(
            statusCode = 200,
            body = """{"data":[]}""",
            correlationId = request.headers["X-Correlation-Id"]
        )
    }
}

class CustomerApiClientTest {
    fun verifyHeadersEndpointsAndIdempotency() {
        val sessionStore = SecureSessionStore(InMemoryEncryptedBackend())
        sessionStore.saveSessionTokens("jwt_alice_001", "refresh_alice_001")
        sessionStore.setPreferredLocale("pt-BR")

        val transport = RecordingHttpTransport()
        val apiClient = CustomerApiClient(
            baseUrl = "https://api.ideliveryfood.local/v1",
            sessionStore = sessionStore,
            transport = transport
        )

        val storesRes = apiClient.fetchPublishedStores()
        check(storesRes.statusCode == 200)
        val firstReq = transport.recordedRequests.last()
        check(firstReq.url.endsWith("/v1/stores?locale=pt-BR"))
        check(firstReq.headers["Authorization"] == "Bearer jwt_alice_001")
        check(firstReq.headers["Accept-Language"] == "pt-BR")
        check(!firstReq.headers["X-Correlation-Id"].isNullOrBlank())

        val quoteRes = apiClient.createServerQuote(
            storeId = "00000000-0000-4000-8000-000000000201",
            addressId = "00000000-0000-4000-8000-000000000801",
            fulfillmentModality = "PLATFORM_DELIVERY",
            items = listOf(MobileCartItem(productId = "00000000-0000-4000-8000-000000000601", quantity = 1)),
            promotionCode = "WELCOME10",
            idempotencyKey = "idem_android_quote_001"
        )
        check(quoteRes.statusCode == 200)
        val quoteReq = transport.recordedRequests.last()
        check(quoteReq.headers["X-Idempotency-Key"] == "idem_android_quote_001")
    }
}
