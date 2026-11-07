package com.ideliveryfood.courier.network

import com.ideliveryfood.courier.dispatch.CourierLocationQueueSample
import com.ideliveryfood.courier.security.CourierSessionManager
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URI
import java.util.UUID

data class CourierProfileDto(
    val courierId: String,
    val displayName: String,
    val vehicleModality: String,
    val approvalStatus: String,
    val isAvailableOnline: Boolean
)

data class CourierSettlementDto(
    val settlementId: String,
    val beneficiaryId: String,
    val periodStartIso: String,
    val periodEndIso: String,
    val grossCents: Int,
    val platformFeeCents: Int,
    val netPayoutCents: Int,
    val payoutStatus: String
)

data class CourierHttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val bodyJson: String? = null
)

data class CourierHttpResponse(
    val statusCode: Int,
    val body: String,
    val correlationId: String?
)

interface CourierHttpTransport {
    fun execute(request: CourierHttpRequest): CourierHttpResponse
}

class UrlConnectionCourierHttpTransport : CourierHttpTransport {
    override fun execute(request: CourierHttpRequest): CourierHttpResponse {
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
        return CourierHttpResponse(
            statusCode = status,
            body = responseBody,
            correlationId = corrId
        )
    }
}

/**
 * Native Android HTTP Client & Offline Location Queue Synchronizer for iDeliveryFood Courier App (M11).
 * Propagates Bearer token from CourierSessionManager, Accept-Language ('en' or 'pt-BR'),
 * X-Correlation-Id, and X-Idempotency-Key. Zero mocked or hardcoded records.
 */
class CourierApiClient(
    baseUrl: String,
    private val sessionManager: CourierSessionManager,
    private val transport: CourierHttpTransport = UrlConnectionCourierHttpTransport()
) {
    private val normalizedBaseUrl: String = baseUrl.trimEnd('/').let {
        if (it.endsWith("/v1")) it else "$it/v1"
    }

    fun buildHeaders(
        idempotencyKey: String? = null,
        correlationId: String = "courier_android_${UUID.randomUUID()}"
    ): Map<String, String> {
        val headers = linkedMapOf(
            "Accept" to "application/json",
            "Content-Type" to "application/json",
            "Accept-Language" to sessionManager.getPreferredLocale(),
            "X-Correlation-Id" to correlationId
        )
        sessionManager.getAccessToken()?.let { token ->
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

    fun submitOnboardingDocuments(
        courierId: String,
        vehicleModality: String,
        documentNumber: String
    ): CourierHttpResponse {
        require(documentNumber.isNotBlank()) { "Document number is required for KYC onboarding." }
        val body = """{"courierId":"$courierId","vehicleModality":"$vehicleModality","documentNumber":"$documentNumber"}"""
        return transport.execute(
            CourierHttpRequest(
                method = "POST",
                url = "$normalizedBaseUrl/courier/onboarding",
                headers = buildHeaders(),
                bodyJson = body
            )
        )
    }

    fun fetchLogisticsOverview(): CourierHttpResponse {
        return transport.execute(
            CourierHttpRequest(
                method = "GET",
                url = "$normalizedBaseUrl/logistics/overview",
                headers = buildHeaders()
            )
        )
    }

    fun acceptDeliveryOffer(
        offerId: String,
        courierId: String,
        idempotencyKey: String
    ): CourierHttpResponse {
        val body = """{"courierId":"$courierId"}"""
        return transport.execute(
            CourierHttpRequest(
                method = "POST",
                url = "$normalizedBaseUrl/logistics/offers/$offerId/accept",
                headers = buildHeaders(idempotencyKey = idempotencyKey),
                bodyJson = body
            )
        )
    }

    fun rejectDeliveryOffer(
        offerId: String,
        courierId: String,
        reason: String
    ): CourierHttpResponse {
        val body = """{"courierId":"$courierId","reason":"$reason"}"""
        return transport.execute(
            CourierHttpRequest(
                method = "POST",
                url = "$normalizedBaseUrl/logistics/offers/$offerId/reject",
                headers = buildHeaders(),
                bodyJson = body
            )
        )
    }

    fun confirmPickupAtStore(
        taskId: String,
        courierId: String,
        idempotencyKey: String
    ): CourierHttpResponse {
        val body = """{"courierId":"$courierId"}"""
        return transport.execute(
            CourierHttpRequest(
                method = "POST",
                url = "$normalizedBaseUrl/logistics/tasks/$taskId/pickup",
                headers = buildHeaders(idempotencyKey = idempotencyKey),
                bodyJson = body
            )
        )
    }

    fun syncQueuedLocationSamples(
        courierId: String,
        samples: List<CourierLocationQueueSample>
    ): List<CourierHttpResponse> {
        return samples.map { sample ->
            val taskField = if (sample.deliveryTaskId != null) "\"${sample.deliveryTaskId}\"" else "null"
            val body = """{"deliveryTaskId":$taskField,"latitude":${sample.latitude},"longitude":${sample.longitude},"accuracyMeters":${sample.accuracyMeters},"recordedAtEpochMillis":${sample.recordedAtEpochMillis}}"""
            transport.execute(
                CourierHttpRequest(
                    method = "POST",
                    url = "$normalizedBaseUrl/logistics/couriers/$courierId/location",
                    headers = buildHeaders(),
                    bodyJson = body
                )
            )
        }
    }

    fun completeDeliveryWithOtp(
        taskId: String,
        courierId: String,
        providedOtp: String,
        idempotencyKey: String
    ): CourierHttpResponse {
        require(providedOtp.matches(Regex("^\\d{4}$"))) {
            "DELIVERY_INVALID_OTP_CODE: 4-digit OTP code is required."
        }
        val body = """{"courierId":"$courierId","otpCode":"$providedOtp"}"""
        return transport.execute(
            CourierHttpRequest(
                method = "POST",
                url = "$normalizedBaseUrl/logistics/tasks/$taskId/complete-otp",
                headers = buildHeaders(idempotencyKey = idempotencyKey),
                bodyJson = body
            )
        )
    }

    fun reportDeliveryIncident(
        taskId: String,
        courierId: String,
        category: String,
        description: String
    ): CourierHttpResponse {
        require(description.isNotBlank()) { "Incident description is required." }
        val body = """{"courierId":"$courierId","category":"$category","description":"$description"}"""
        return transport.execute(
            CourierHttpRequest(
                method = "POST",
                url = "$normalizedBaseUrl/logistics/tasks/$taskId/incidents",
                headers = buildHeaders(),
                bodyJson = body
            )
        )
    }

    fun fetchCourierSettlements(courierId: String): CourierHttpResponse {
        return transport.execute(
            CourierHttpRequest(
                method = "GET",
                url = "$normalizedBaseUrl/finance/settlements?beneficiaryType=COURIER&beneficiaryId=$courierId",
                headers = buildHeaders()
            )
        )
    }
}
