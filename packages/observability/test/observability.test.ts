import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCorrelatedRequestHeaders,
  computeLatencyPercentiles,
  createOperationalMetricsCollector,
  createStructuredLogEntry,
  evaluateOperationalAlertRules,
  formatOperationalMetricsPrometheus,
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

  it("collects runtime HTTP & PSP webhook metrics, evaluates M25 SLI/SLO alert rules, and formats Prometheus output", () => {
    const collector = createOperationalMetricsCollector(5);
    collector.recordHttpRequest({ statusCode: 200, durationMs: 12.5 });
    collector.recordHttpRequest({ statusCode: 201, durationMs: 25.0 });
    collector.recordHttpRequest({ statusCode: 401, durationMs: 4.0 });
    collector.recordHttpRequest({ statusCode: 403, durationMs: 6.0 });
    collector.recordHttpRequest({ statusCode: 429, durationMs: 2.0 });
    collector.recordHttpRequest({ statusCode: 500, durationMs: 1800.0 });

    collector.recordPspWebhookOutcome("SUCCESS");
    collector.recordPspWebhookOutcome("DUPLICATE");
    collector.recordPspWebhookOutcome("FAILURE");

    const snap = collector.getHttpSnapshot();
    assert.equal(snap.totalRequests, 6);
    assert.equal(snap.http2xxCount, 2);
    assert.equal(snap.http4xxCount, 3);
    assert.equal(snap.http401UnauthorizedCount, 1);
    assert.equal(snap.http403ForbiddenCount, 1);
    assert.equal(snap.http429RateLimitedCount, 1);
    assert.equal(snap.http5xxCount, 1);
    assert.equal(snap.pspWebhookSuccessCount, 1);
    assert.equal(snap.pspWebhookDuplicateCount, 1);
    assert.equal(snap.pspWebhookFailureCount, 1);
    assert.equal(snap.latency.count, 5); // bounded ring buffer max 5

    // Healthy database snapshot with relaxed thresholds -> only PSP failure & p95 latency alert
    const healthyDb = {
      outboxPendingCount: 2,
      outboxDeadLetterCount: 0,
      outboxDeliveredCount: 15,
      reconciliationDiscrepancyRunsCount: 0,
      reconciliationDiscrepancyTotalCents: 0,
      isLedgerBalanced: true,
      totalDebitsCents: 14135,
      totalCreditsCents: 14135,
      openRiskAlertsCount: 1,
      activeDeliveryTasksCount: 1,
      processedWebhookEventsCount: 4,
    };

    const report = collector.buildReport({
      database: healthyDb,
      thresholds: {
        maxHttpP95LatencyMs: 500,
        maxOutboxPendingBacklog: 10,
        maxSecurityDenialSpikeCount: 10,
      },
    });
    assert.equal(report.service, "@ideliveryfood/api");
    assert.ok(
      report.alerts.some((a) => a.ruleCode === "ALERT_PSP_WEBHOOK_FAILURES_DETECTED")
    );
    assert.ok(
      report.alerts.some((a) => a.ruleCode === "ALERT_HTTP_P95_LATENCY_SLO_BREACH")
    );

    // Degraded database snapshot triggering all remaining alert rules
    const degradedAlerts = evaluateOperationalAlertRules({
      http: snap,
      database: {
        ...healthyDb,
        isLedgerBalanced: false,
        totalDebitsCents: 15000,
        totalCreditsCents: 14135,
        outboxDeadLetterCount: 2,
        outboxPendingCount: 250,
        reconciliationDiscrepancyRunsCount: 1,
        reconciliationDiscrepancyTotalCents: 865,
      },
      thresholds: {
        maxOutboxPendingBacklog: 100,
        maxHttpP95LatencyMs: 500,
        maxSecurityDenialSpikeCount: 2,
      },
    });
    const codes = new Set(degradedAlerts.map((a) => a.ruleCode));
    assert.equal(codes.has("ALERT_LEDGER_IMBALANCE_DETECTED"), true);
    assert.equal(codes.has("ALERT_OUTBOX_DEAD_LETTER_DETECTED"), true);
    assert.equal(codes.has("ALERT_OUTBOX_BACKLOG_HIGH"), true);
    assert.equal(codes.has("ALERT_RECONCILIATION_DISCREPANCIES_DETECTED"), true);
    assert.equal(codes.has("ALERT_SECURITY_FORBIDDEN_OR_RATE_LIMIT_SPIKE"), true);

    const promText = formatOperationalMetricsPrometheus(report);
    assert.match(promText, /ideliveryfood_http_requests_total\{status="all"\} 6/);
    assert.match(promText, /ideliveryfood_outbox_events_count\{status="DEAD_LETTER"\} 0/);
    assert.match(promText, /ideliveryfood_ledger_balanced 1/);
  });
});
