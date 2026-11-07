package com.ideliveryfood.courier.network

import com.ideliveryfood.courier.dispatch.CourierLocationQueueSample
import com.ideliveryfood.courier.security.CourierSessionManager
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

private class RecordingCourierHttpTransport : CourierHttpTransport {
    val requests = mutableListOf<CourierHttpRequest>()

    override fun execute(request: CourierHttpRequest): CourierHttpResponse {
        requests.add(request)
        return CourierHttpResponse(
            statusCode = 200,
            body = """{"status":"ok"}""",
            correlationId = request.headers["X-Correlation-Id"]
        )
    }
}

class CourierApiClientTest {
    @Test
    fun `propagates Bearer token, Accept-Language, X-Correlation-Id, and X-Idempotency-Key across courier endpoints`() {
        val session = CourierSessionManager()
        session.saveTokens("jwt_courier_access_001", "jwt_courier_refresh_001")
        session.setPreferredLocale("pt-BR")

        val transport = RecordingCourierHttpTransport()
        val client = CourierApiClient(
            baseUrl = "https://api.ideliveryfood.local",
            sessionManager = session,
            transport = transport
        )

        val acceptResp = client.acceptDeliveryOffer(
            offerId = "91000000-0000-4000-8000-000000000001",
            courierId = "00000000-0000-4000-8000-000000000041",
            idempotencyKey = "courier_accept_idem_01"
        )
        assertEquals(200, acceptResp.statusCode)
        assertEquals(
            "https://api.ideliveryfood.local/v1/logistics/offers/91000000-0000-4000-8000-000000000001/accept",
            transport.requests[0].url
        )
        assertEquals("Bearer jwt_courier_access_001", transport.requests[0].headers["Authorization"])
        assertEquals("pt-BR", transport.requests[0].headers["Accept-Language"])
        assertEquals("courier_accept_idem_01", transport.requests[0].headers["X-Idempotency-Key"])

        val syncResps = client.syncQueuedLocationSamples(
            courierId = "00000000-0000-4000-8000-000000000041",
            samples = listOf(
                CourierLocationQueueSample(
                    deliveryTaskId = "90000000-0000-4000-8000-000000000001",
                    latitude = -23.5615,
                    longitude = -46.6560,
                    accuracyMeters = 6.5,
                    recordedAtEpochMillis = 1730000000000L
                )
            )
        )
        assertEquals(1, syncResps.size)
        assertTrue(transport.requests[1].url.endsWith("/v1/logistics/couriers/00000000-0000-4000-8000-000000000041/location"))

        val otpResp = client.completeDeliveryWithOtp(
            taskId = "90000000-0000-4000-8000-000000000001",
            courierId = "00000000-0000-4000-8000-000000000041",
            providedOtp = "4829",
            idempotencyKey = "courier_otp_idem_01"
        )
        assertEquals(200, otpResp.statusCode)
    }
}
