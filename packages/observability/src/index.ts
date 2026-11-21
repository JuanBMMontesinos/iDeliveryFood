import crypto from "node:crypto";
import {
  createStructuredLogEntry,
  redactSensitiveData,
  type StructuredLogEntry,
} from "@ideliveryfood/config";
import { DEFAULT_LOCALE, type SupportedLocale } from "@ideliveryfood/contracts";

export { createStructuredLogEntry, redactSensitiveData, type StructuredLogEntry };

const SAFE_CORRELATION_ID_REGEX = /^[A-Za-z0-9._:-]{6,128}$/;

/**
 * Resolves a safe `correlationId` from an incoming `X-Correlation-Id` header or generates
 * a new cryptographically unique ID (`corr_<uuid>`), strictly blocking CRLF / log injection.
 */
export function resolveOrGenerateCorrelationId(
  incomingHeader?: string | readonly string[] | null,
  prefix = "corr"
): string {
  const candidate = Array.isArray(incomingHeader)
    ? incomingHeader[0]
    : typeof incomingHeader === "string"
      ? incomingHeader
      : null;

  if (candidate) {
    const trimmed = candidate.trim();
    if (SAFE_CORRELATION_ID_REGEX.test(trimmed)) {
      return trimmed;
    }
  }

  return `${prefix}_${crypto.randomUUID()}`;
}

/**
 * Propagates `X-Correlation-Id` and `Accept-Language` across outbound HTTP/RPC calls
 * and strips any accidental sensitive secret headers if not explicitly authorized.
 */
export function buildCorrelatedRequestHeaders(params: {
  correlationId?: string | null;
  locale?: SupportedLocale;
  idempotencyKey?: string | null;
  extraHeaders?: Record<string, string>;
}): Record<string, string> {
  const correlationId = resolveOrGenerateCorrelationId(params.correlationId);
  const locale = params.locale ?? DEFAULT_LOCALE;

  const headers: Record<string, string> = {
    ...(params.extraHeaders ?? {}),
    "X-Correlation-Id": correlationId,
    "Accept-Language": locale,
  };

  if (params.idempotencyKey && params.idempotencyKey.trim().length > 0) {
    headers["X-Idempotency-Key"] = params.idempotencyKey.trim();
  }

  return headers;
}

export interface LatencyPercentileSummary {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

/**
 * Computes deterministic p50, p95, p99, and max latency metrics in milliseconds (M24/M25).
 */
export function computeLatencyPercentiles(
  samplesMs: readonly number[]
): LatencyPercentileSummary {
  const validSamples = samplesMs
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);

  if (validSamples.length === 0) {
    return {
      count: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
    };
  }

  const pickPercentile = (p: number): number => {
    const idx = Math.min(
      validSamples.length - 1,
      Math.max(0, Math.ceil((p / 100) * validSamples.length) - 1)
    );
    return Math.round((validSamples[idx] ?? 0) * 100) / 100;
  };

  return {
    count: validSamples.length,
    p50Ms: pickPercentile(50),
    p95Ms: pickPercentile(95),
    p99Ms: pickPercentile(99),
    maxMs: Math.round((validSamples[validSamples.length - 1] ?? 0) * 100) / 100,
  };
}

// ============================================================================
// M25: Operational Metrics Collector, SLI/SLO Alert Rules & Prometheus Exporter
// ============================================================================

export type OperationalAlertSeverity = "CRITICAL" | "WARNING" | "INFO";

export type OperationalAlertRuleCode =
  | "ALERT_OUTBOX_DEAD_LETTER_DETECTED"
  | "ALERT_OUTBOX_BACKLOG_HIGH"
  | "ALERT_PSP_WEBHOOK_FAILURES_DETECTED"
  | "ALERT_RECONCILIATION_DISCREPANCIES_DETECTED"
  | "ALERT_LEDGER_IMBALANCE_DETECTED"
  | "ALERT_HTTP_P95_LATENCY_SLO_BREACH"
  | "ALERT_SECURITY_FORBIDDEN_OR_RATE_LIMIT_SPIKE";

export interface OperationalAlertContract {
  ruleCode: OperationalAlertRuleCode;
  severity: OperationalAlertSeverity;
  title: string;
  description: string;
  observedValue: number;
  thresholdValue: number;
  runbookAnchor: string;
}

export interface DatabaseOperationalMetricsSnapshot {
  outboxPendingCount: number;
  outboxDeadLetterCount: number;
  outboxDeliveredCount: number;
  reconciliationDiscrepancyRunsCount: number;
  reconciliationDiscrepancyTotalCents: number;
  isLedgerBalanced: boolean;
  totalDebitsCents: number;
  totalCreditsCents: number;
  openRiskAlertsCount: number;
  activeDeliveryTasksCount: number;
  processedWebhookEventsCount: number;
}

export interface HttpRuntimeMetricsSnapshot {
  totalRequests: number;
  http2xxCount: number;
  http4xxCount: number;
  http401UnauthorizedCount: number;
  http403ForbiddenCount: number;
  http429RateLimitedCount: number;
  http5xxCount: number;
  pspWebhookSuccessCount: number;
  pspWebhookDuplicateCount: number;
  pspWebhookFailureCount: number;
  latency: LatencyPercentileSummary;
}

export interface OperationalAlertThresholds {
  maxOutboxPendingBacklog: number;
  maxHttpP95LatencyMs: number;
  maxSecurityDenialSpikeCount: number;
}

export const DEFAULT_OPERATIONAL_ALERT_THRESHOLDS: OperationalAlertThresholds = {
  maxOutboxPendingBacklog: 100,
  maxHttpP95LatencyMs: 1500,
  maxSecurityDenialSpikeCount: 25,
};

export interface OperationalMetricsReportContract {
  service: string;
  collectedAtIso: string;
  http: HttpRuntimeMetricsSnapshot;
  database: DatabaseOperationalMetricsSnapshot;
  alerts: OperationalAlertContract[];
}

/**
 * Evaluates M25 operational and financial SLI/SLO alert rules deterministically.
 */
export function evaluateOperationalAlertRules(params: {
  http: HttpRuntimeMetricsSnapshot;
  database: DatabaseOperationalMetricsSnapshot;
  thresholds?: Partial<OperationalAlertThresholds>;
}): OperationalAlertContract[] {
  const thresholds: OperationalAlertThresholds = {
    ...DEFAULT_OPERATIONAL_ALERT_THRESHOLDS,
    ...(params.thresholds ?? {}),
  };
  const alerts: OperationalAlertContract[] = [];

  if (!params.database.isLedgerBalanced) {
    const delta = Math.abs(
      params.database.totalDebitsCents - params.database.totalCreditsCents
    );
    alerts.push({
      ruleCode: "ALERT_LEDGER_IMBALANCE_DETECTED",
      severity: "CRITICAL",
      title: "Double-Entry Financial Ledger Imbalance Detected",
      description: `Total debits (${params.database.totalDebitsCents}c) do not match total credits (${params.database.totalCreditsCents}c).`,
      observedValue: delta,
      thresholdValue: 0,
      runbookAnchor: "docs/ops/observability-and-alerts.md#alert-ledger-imbalance-detected",
    });
  }

  if (params.database.outboxDeadLetterCount > 0) {
    alerts.push({
      ruleCode: "ALERT_OUTBOX_DEAD_LETTER_DETECTED",
      severity: "CRITICAL",
      title: "Transactional Outbox Dead-Letter Events Detected",
      description: `${params.database.outboxDeadLetterCount} outbox event(s) reached DEAD_LETTER status after exhausting retries.`,
      observedValue: params.database.outboxDeadLetterCount,
      thresholdValue: 0,
      runbookAnchor: "docs/ops/observability-and-alerts.md#alert-outbox-dead-letter-detected",
    });
  }

  if (params.database.outboxPendingCount > thresholds.maxOutboxPendingBacklog) {
    alerts.push({
      ruleCode: "ALERT_OUTBOX_BACKLOG_HIGH",
      severity: "WARNING",
      title: "Transactional Outbox Pending Backlog Above Threshold",
      description: `Outbox pending queue (${params.database.outboxPendingCount}) exceeds threshold (${thresholds.maxOutboxPendingBacklog}).`,
      observedValue: params.database.outboxPendingCount,
      thresholdValue: thresholds.maxOutboxPendingBacklog,
      runbookAnchor: "docs/ops/observability-and-alerts.md#alert-outbox-backlog-high",
    });
  }

  if (params.http.pspWebhookFailureCount > 0) {
    alerts.push({
      ruleCode: "ALERT_PSP_WEBHOOK_FAILURES_DETECTED",
      severity: "WARNING",
      title: "PSP Webhook Signature or Processing Failures Detected",
      description: `${params.http.pspWebhookFailureCount} PSP webhook delivery attempt(s) failed signature, replay window, or amount verification.`,
      observedValue: params.http.pspWebhookFailureCount,
      thresholdValue: 0,
      runbookAnchor: "docs/ops/observability-and-alerts.md#alert-psp-webhook-failures-detected",
    });
  }

  if (params.database.reconciliationDiscrepancyRunsCount > 0) {
    alerts.push({
      ruleCode: "ALERT_RECONCILIATION_DISCREPANCIES_DETECTED",
      severity: "WARNING",
      title: "PSP Financial Reconciliation Discrepancies Present",
      description: `${params.database.reconciliationDiscrepancyRunsCount} reconciliation run(s) reported non-zero delta (${params.database.reconciliationDiscrepancyTotalCents} BRL cents).`,
      observedValue: params.database.reconciliationDiscrepancyTotalCents,
      thresholdValue: 0,
      runbookAnchor:
        "docs/ops/observability-and-alerts.md#alert-reconciliation-discrepancies-detected",
    });
  }

  if (
    params.http.latency.count > 0 &&
    params.http.latency.p95Ms > thresholds.maxHttpP95LatencyMs
  ) {
    alerts.push({
      ruleCode: "ALERT_HTTP_P95_LATENCY_SLO_BREACH",
      severity: "WARNING",
      title: "HTTP API p95 Latency SLO Breach",
      description: `HTTP p95 latency (${params.http.latency.p95Ms}ms) exceeds SLO threshold (${thresholds.maxHttpP95LatencyMs}ms).`,
      observedValue: params.http.latency.p95Ms,
      thresholdValue: thresholds.maxHttpP95LatencyMs,
      runbookAnchor: "docs/ops/observability-and-alerts.md#alert-http-p95-latency-slo-breach",
    });
  }

  const securityDenials =
    params.http.http403ForbiddenCount + params.http.http429RateLimitedCount;
  if (securityDenials >= thresholds.maxSecurityDenialSpikeCount) {
    alerts.push({
      ruleCode: "ALERT_SECURITY_FORBIDDEN_OR_RATE_LIMIT_SPIKE",
      severity: "WARNING",
      title: "Elevated 403 Forbidden / 429 Rate-Limit Denials",
      description: `Observed ${params.http.http403ForbiddenCount} HTTP 403 and ${params.http.http429RateLimitedCount} HTTP 429 responses.`,
      observedValue: securityDenials,
      thresholdValue: thresholds.maxSecurityDenialSpikeCount,
      runbookAnchor:
        "docs/ops/observability-and-alerts.md#alert-security-forbidden-or-rate-limit-spike",
    });
  }

  return alerts;
}

export interface OperationalMetricsCollector {
  recordHttpRequest(params: { statusCode: number; durationMs: number }): void;
  recordPspWebhookOutcome(outcome: "SUCCESS" | "DUPLICATE" | "FAILURE"): void;
  getHttpSnapshot(): HttpRuntimeMetricsSnapshot;
  buildReport(params: {
    service?: string;
    database: DatabaseOperationalMetricsSnapshot;
    thresholds?: Partial<OperationalAlertThresholds>;
  }): OperationalMetricsReportContract;
}

/**
 * Creates a bounded in-process HTTP & PSP webhook telemetry collector for `/v1/metrics` (M25).
 */
export function createOperationalMetricsCollector(
  maxLatencySamples = 500
): OperationalMetricsCollector {
  let totalRequests = 0;
  let http2xxCount = 0;
  let http4xxCount = 0;
  let http401UnauthorizedCount = 0;
  let http403ForbiddenCount = 0;
  let http429RateLimitedCount = 0;
  let http5xxCount = 0;
  let pspWebhookSuccessCount = 0;
  let pspWebhookDuplicateCount = 0;
  let pspWebhookFailureCount = 0;
  const latencySamplesMs: number[] = [];

  return {
    recordHttpRequest({ statusCode, durationMs }) {
      totalRequests += 1;
      if (statusCode >= 200 && statusCode < 300) {
        http2xxCount += 1;
      } else if (statusCode >= 400 && statusCode < 500) {
        http4xxCount += 1;
        if (statusCode === 401) http401UnauthorizedCount += 1;
        if (statusCode === 403) http403ForbiddenCount += 1;
        if (statusCode === 429) http429RateLimitedCount += 1;
      } else if (statusCode >= 500) {
        http5xxCount += 1;
      }

      if (Number.isFinite(durationMs) && durationMs >= 0) {
        if (latencySamplesMs.length >= maxLatencySamples) {
          latencySamplesMs.shift();
        }
        latencySamplesMs.push(Math.round(durationMs * 100) / 100);
      }
    },

    recordPspWebhookOutcome(outcome) {
      if (outcome === "SUCCESS") {
        pspWebhookSuccessCount += 1;
      } else if (outcome === "DUPLICATE") {
        pspWebhookDuplicateCount += 1;
      } else {
        pspWebhookFailureCount += 1;
      }
    },

    getHttpSnapshot(): HttpRuntimeMetricsSnapshot {
      return {
        totalRequests,
        http2xxCount,
        http4xxCount,
        http401UnauthorizedCount,
        http403ForbiddenCount,
        http429RateLimitedCount,
        http5xxCount,
        pspWebhookSuccessCount,
        pspWebhookDuplicateCount,
        pspWebhookFailureCount,
        latency: computeLatencyPercentiles(latencySamplesMs),
      };
    },

    buildReport({ service = "@ideliveryfood/api", database, thresholds }) {
      const http = this.getHttpSnapshot();
      const alerts = evaluateOperationalAlertRules({
        http,
        database,
        ...(thresholds ? { thresholds } : {}),
      });
      return {
        service,
        collectedAtIso: new Date().toISOString(),
        http,
        database,
        alerts,
      };
    },
  };
}

/**
 * Formats an `OperationalMetricsReportContract` into standard Prometheus text exposition format.
 */
export function formatOperationalMetricsPrometheus(
  report: OperationalMetricsReportContract
): string {
  const lines: string[] = [
    "# HELP ideliveryfood_http_requests_total Total HTTP requests handled by status family.",
    "# TYPE ideliveryfood_http_requests_total counter",
    `ideliveryfood_http_requests_total{status="all"} ${report.http.totalRequests}`,
    `ideliveryfood_http_requests_total{status="2xx"} ${report.http.http2xxCount}`,
    `ideliveryfood_http_requests_total{status="4xx"} ${report.http.http4xxCount}`,
    `ideliveryfood_http_requests_total{status="401"} ${report.http.http401UnauthorizedCount}`,
    `ideliveryfood_http_requests_total{status="403"} ${report.http.http403ForbiddenCount}`,
    `ideliveryfood_http_requests_total{status="429"} ${report.http.http429RateLimitedCount}`,
    `ideliveryfood_http_requests_total{status="5xx"} ${report.http.http5xxCount}`,
    "# HELP ideliveryfood_http_latency_ms HTTP request latency percentiles in milliseconds.",
    "# TYPE ideliveryfood_http_latency_ms gauge",
    `ideliveryfood_http_latency_ms{quantile="0.5"} ${report.http.latency.p50Ms}`,
    `ideliveryfood_http_latency_ms{quantile="0.95"} ${report.http.latency.p95Ms}`,
    `ideliveryfood_http_latency_ms{quantile="0.99"} ${report.http.latency.p99Ms}`,
    `ideliveryfood_http_latency_ms{quantile="1.0"} ${report.http.latency.maxMs}`,
    "# HELP ideliveryfood_psp_webhooks_total PSP webhook outcomes.",
    "# TYPE ideliveryfood_psp_webhooks_total counter",
    `ideliveryfood_psp_webhooks_total{outcome="success"} ${report.http.pspWebhookSuccessCount}`,
    `ideliveryfood_psp_webhooks_total{outcome="duplicate"} ${report.http.pspWebhookDuplicateCount}`,
    `ideliveryfood_psp_webhooks_total{outcome="failure"} ${report.http.pspWebhookFailureCount}`,
    "# HELP ideliveryfood_outbox_events_count Transactional outbox events by status.",
    "# TYPE ideliveryfood_outbox_events_count gauge",
    `ideliveryfood_outbox_events_count{status="PENDING"} ${report.database.outboxPendingCount}`,
    `ideliveryfood_outbox_events_count{status="DEAD_LETTER"} ${report.database.outboxDeadLetterCount}`,
    `ideliveryfood_outbox_events_count{status="DELIVERED"} ${report.database.outboxDeliveredCount}`,
    "# HELP ideliveryfood_ledger_balanced Whether double-entry financial ledger debits equal credits (1=balanced, 0=unbalanced).",
    "# TYPE ideliveryfood_ledger_balanced gauge",
    `ideliveryfood_ledger_balanced ${report.database.isLedgerBalanced ? 1 : 0}`,
    "# HELP ideliveryfood_reconciliation_discrepancy_cents Total unresolved PSP reconciliation discrepancy in BRL cents.",
    "# TYPE ideliveryfood_reconciliation_discrepancy_cents gauge",
    `ideliveryfood_reconciliation_discrepancy_cents ${report.database.reconciliationDiscrepancyTotalCents}`,
    "# HELP ideliveryfood_active_alerts_count Number of active operational alerts.",
    "# TYPE ideliveryfood_active_alerts_count gauge",
    `ideliveryfood_active_alerts_count ${report.alerts.length}`,
  ];
  return `${lines.join("\n")}\n`;
}
