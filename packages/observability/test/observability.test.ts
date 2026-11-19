import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCorrelatedRequestHeaders,
  computeLatencyPercentiles,
  createStructuredLogEntry,
  redactSensitiveData,
  resolveOrGenerateCorrelationId,
} from "../src/index.js";

describe("@ideliveryfood/observability — Recursive PII/Secret Redaction, Correlation ID Propagation & Latency Percentiles", () => {
  it("recursively redacts tokens, passwords, CPF/CNPJ, cards, private keys, and inline Bearer tokens", () => {
    assert.equal(redactSensitiveData(null), null);
    assert.equal(redactSensitiveData(undefined), undefined);
    assert.equal(redactSensitiveData(42), 42);
    assert.equal(
      redactSensitiveData("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"),
      "Authorization: Bearer [REDACTED_TOKEN]"
    );

    const payload = {
      orderId: "00000000-0000-4000-8000-000000001001",
      password: "raw-password",
      access_token: "raw-access-token",
      refresh_token: "raw-refresh-token",
      service_role_key: "sbp_secret_value",
      cpf: "12345678901",
      cnpj: "12345678000199",
      tax_id: "12345678000199",
      card_number: "4111111111111111",
      cvv: "999",
      private_key: "pem-material",
      items: [
        {
          sku: "BURGER-01",
          apiKey: "secret-api-key",
          headerNote: "Forwarded Bearer secret_jwt_token_value_123 to upstream",
        },
      ],
    };

    const redacted = redactSensitiveData(payload);
    assert.equal(redacted.orderId, "00000000-0000-4000-8000-000000001001");
    assert.equal(redacted.password, "[REDACTED]");
    assert.equal(redacted.access_token, "[REDACTED]");
    assert.equal(redacted.refresh_token, "[REDACTED]");
    assert.equal(redacted.service_role_key, "[REDACTED]");
    assert.equal(redacted.cpf, "[REDACTED]");
    assert.equal(redacted.cnpj, "[REDACTED]");
    assert.equal(redacted.tax_id, "[REDACTED]");
    assert.equal(redacted.card_number, "[REDACTED]");
    assert.equal(redacted.cvv, "[REDACTED]");
    assert.equal(redacted.private_key, "[REDACTED]");
    assert.equal(redacted.items[0]?.sku, "BURGER-01");
    assert.equal(redacted.items[0]?.apiKey, "[REDACTED]");
    assert.match(redacted.items[0]?.headerNote ?? "", /Bearer \[REDACTED_TOKEN\]/);
  });

  it("creates structured log entries with correlationId and automatic context redaction", () => {
    const infoLog = createStructuredLogEntry({
      level: "INFO",
      service: "@ideliveryfood/api",
      correlationId: "corr_req_1001",
      message: "Order #10001 created with Bearer token_abc123",
      context: {
        actorId: "00000000-0000-4000-8000-000000000001",
        secret: "hidden",
      },
    });
    assert.equal(infoLog.level, "INFO");
    assert.equal(infoLog.service, "@ideliveryfood/api");
    assert.equal(infoLog.correlationId, "corr_req_1001");
    assert.match(infoLog.message, /Bearer \[REDACTED_TOKEN\]/);
    assert.equal(infoLog.context?.secret, "[REDACTED]");

    const warnWithoutContext = createStructuredLogEntry({
      level: "WARN",
      service: "@ideliveryfood/worker",
      correlationId: "corr_worker_1",
      message: "Retry scheduled",
    });
    assert.equal(warnWithoutContext.context, undefined);
  });

  it("validates and propagates X-Correlation-Id while rejecting CRLF or malformed correlation headers", () => {
    assert.equal(
      resolveOrGenerateCorrelationId("corr_client_trace:2026.11-19"),
      "corr_client_trace:2026.11-19"
    );
    assert.equal(
      resolveOrGenerateCorrelationId(["corr_array_first_001", "corr_second"]),
      "corr_array_first_001"
    );

    // Rejects CRLF injection or too-short IDs and generates a clean corr_<uuid>
    const fromInjected = resolveOrGenerateCorrelationId("bad_id\r\nX-Injected: pwned");
    assert.match(fromInjected, /^corr_[0-9a-f-]{36}$/i);

    const fromNull = resolveOrGenerateCorrelationId(null, "trace");
    assert.match(fromNull, /^trace_[0-9a-f-]{36}$/i);

    const headers = buildCorrelatedRequestHeaders({
      correlationId: "corr_propagated_99",
      locale: "pt-BR",
      idempotencyKey: "idem_checkout_001",
      extraHeaders: { "X-Custom": "1" },
    });
    assert.equal(headers["X-Correlation-Id"], "corr_propagated_99");
    assert.equal(headers["Accept-Language"], "pt-BR");
    assert.equal(headers["X-Idempotency-Key"], "idem_checkout_001");
    assert.equal(headers["X-Custom"], "1");

    const defaultHeaders = buildCorrelatedRequestHeaders({});
    assert.equal(defaultHeaders["Accept-Language"], "en");
    assert.match(defaultHeaders["X-Correlation-Id"] ?? "", /^corr_/);
    assert.equal(defaultHeaders["X-Idempotency-Key"], undefined);
  });

  it("computes p50, p95, p99, and max latency percentiles accurately", () => {
    const empty = computeLatencyPercentiles([]);
    assert.deepEqual(empty, { count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 });

    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1ms .. 100ms
    const summary = computeLatencyPercentiles(samples);
    assert.equal(summary.count, 100);
    assert.equal(summary.p50Ms, 50);
    assert.equal(summary.p95Ms, 95);
    assert.equal(summary.p99Ms, 99);
    assert.equal(summary.maxMs, 100);
  });
});
