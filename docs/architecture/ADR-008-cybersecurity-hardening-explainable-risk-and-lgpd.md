# ADR-008: Transverse Cybersecurity Hardening, Explainable Human-Reviewed Risk Engine, LGPD Art. 18 Compliance & Operational Telemetry

- **Status:** Approved
- **Date:** 2026-11-19
- **Module:** `M21` / `M23` / `M25`

## Context
A multi-tenant marketplace handling financial settlements, geolocation, and personal data under Brazilian law (LGPD — Lei nº 13.709/2018) requires defense-in-depth HTTP/Storage security, explainable fraud detection without opaque automated account bans, auditable LGPD data portability and retention holds, and real-time operational observability.

## Decision
1. **Defense-in-Depth HTTP, Payload & Storage Hardening (`M23`):**
   - `@ideliveryfood/api` and all 3 Next.js portals enforce strict `Content-Security-Policy` (without `unsafe-eval`), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: strict-origin-when-cross-origin`.
   - CORS uses an explicit origin allowlist (`CORS_ALLOWED_ORIGINS`) and never returns `*` on authenticated routes; cookie-authenticated mutations enforce Anti-CSRF (`Origin`/`Referer` + `X-CSRF-Token`).
   - Sliding-window rate limiting (`SlidingWindowRateLimiter`) protects `AUTH_LOGIN`, `OTP_VERIFY`, `COUPON_REDEEM`, `CHECKOUT_ORDERS`, `SUPPORT_MUTATION`, and `SENSITIVE_EXPORT` routes (`429 TOO_MANY_REQUESTS` + `Retry-After`).
   - Anti-mass-assignment blocks privileged fields (`role`, `organization_id`, `status`, `is_approved`, `price_cents`, `total_cents`) on consumer/partner payloads (`400 MASS_ASSIGNMENT_FORBIDDEN`).
   - Anti-SSRF (`validateExternalWebhookUrlAgainstSsrf`) blocks non-HTTPS, loopback, RFC 1918 private IPs, and cloud metadata (`169.254.169.254`) on external webhook targets.
   - All 13 Supabase Storage buckets enforce MIME allowlists, size limits, and path traversal checks, explicitly blocking `.svg`, `.html`, `.js`, and executables.

2. **Explainable Risk Alerts with Mandatory Human Review (`M21`):**
   - Risk rules (`VELOCITY_HIGH_REFUND_RATE`, `HIGH_VALUE_ORDER_NEW_ACCOUNT`, `COURIER_GPS_TELEPORT_ANOMALY`, `REPEATED_FAILED_PAYMENT_ATTEMPTS`) store structured bilingual explanations (`rule_explanation_json` with `observedValue`, `thresholdValue`, `evidenceRefs`) in `public.risk_alerts` with status `OPEN_AWAITING_HUMAN_REVIEW`.
   - Automated rules **never** execute opaque permanent bans; restrictions require human review by `risk_compliance` or `tech_admin` with MFA `aal2`, recorded in append-only `public.risk_decisions`.

3. **LGPD Art. 18 Portability & 5-Year Fiscal Retention Hold (`M21`):**
   - Users can export a structured JSON portability package (`GET /v1/me/lgpd-export`) and request account anonymization/deletion (`POST /v1/me/privacy-requests`).
   - If the user has active orders, open disputes, or completed fiscal transactions within the statutory 5-year retention window, deletion is placed on `RETENTION_HOLD` (`hold_until`); otherwise PII is anonymized in `public.profiles` and all devices in `public.user_devices` are immediately revoked.

4. **Redacted Structured Logging & `/v1/metrics` Observability (`M25`):**
   - All logs and `audit_logs.redacted_payload` pass through `redactSensitiveData`.
   - `GET /v1/metrics` (restricted to `tech_admin`/`operations` with MFA `aal2`, supporting JSON and `?format=prometheus`) exposes HTTP latency percentiles (`p50`/`p95`/`p99`), PSP webhook outcomes, outbox backlog/`DEAD_LETTER` count, ledger balance health, and active SLI/SLO alerts.

## Consequences
- Zero unreviewed automated account bans, full LGPD Art. 18 auditability, and deterministic security/observability gates in CI/CD.
