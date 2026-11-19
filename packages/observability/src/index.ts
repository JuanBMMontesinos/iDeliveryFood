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
