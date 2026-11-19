import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SlidingWindowRateLimiter,
  buildHttpSecurityHeaders,
  buildSecureSessionCookieHeader,
  classifyRateLimitRouteBucket,
  createStructuredLogEntry,
  evaluateCorsRequest,
  evaluateCsrfProtection,
  inspectProviderReadiness,
  redactSensitiveData,
  validateExternalWebhookUrlAgainstSsrf,
  validatePayloadAgainstMassAssignment,
  validatePublicWebEnv,
  validateServerEnv,
  validateStorageUploadSecurity,
} from "../src/index.js";

describe("@ideliveryfood/config — Env Validation, Provider Readiness & Redaction Tests", () => {
  it("validates public web env and defaults to 'en', 'BRL', and 'America/Sao_Paulo'", () => {
    const cfg = validatePublicWebEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://dwsoochnfxldfvcaijie.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon_public_key_placeholder_12345",
    });

    assert.equal(cfg.supabaseUrl, "https://dwsoochnfxldfvcaijie.supabase.co");
    assert.equal(cfg.defaultLocale, "en");
    assert.equal(cfg.currencyCode, "BRL");
    assert.equal(cfg.operationalTimezone, "America/Sao_Paulo");
  });

  it("blocks server secrets from leaking into NEXT_PUBLIC_* variables", () => {
    assert.throws(
      () =>
        validatePublicWebEnv({
          NEXT_PUBLIC_SUPABASE_URL: "https://dwsoochnfxldfvcaijie.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon_public_key_placeholder_12345",
          NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "secret_service_role",
        }),
      /SECURITY_ENV_LEAK/
    );

    assert.throws(
      () =>
        validatePublicWebEnv({
          NEXT_PUBLIC_SUPABASE_URL: "https://dwsoochnfxldfvcaijie.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ["sk", "live", "synthetic_leak_check"].join("_"),
        }),
      /SECURITY_ENV_LEAK/
    );
  });

  it("validates server environment variables", () => {
    const serverCfg = validateServerEnv({
      SUPABASE_URL: "https://dwsoochnfxldfvcaijie.supabase.co",
      SUPABASE_ANON_KEY: "anon_public_key_placeholder_12345",
      API_PORT: "4000",
      APP_ENV: "development",
    });
    assert.equal(serverCfg.apiPort, 4000);
    assert.equal(serverCfg.appEnv, "development");
  });

  it("reports external providers honestly as BLOCKED_MISSING_CREDENTIALS when env vars are absent", () => {
    const statuses = inspectProviderReadiness({});
    assert.equal(statuses.length, 8);
    for (const p of statuses) {
      assert.equal(p.status, "BLOCKED_MISSING_CREDENTIALS");
      assert.ok(p.missingEnvVars.length > 0);
    }

    const withStripe = inspectProviderReadiness({
      STRIPE_SECRET_KEY: "sk_test_configured",
      STRIPE_WEBHOOK_SECRET: "whsec_configured",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_configured",
    });
    const stripe = withStripe.find((p) => p.providerCode === "stripe");
    assert.equal(stripe?.status, "SANDBOX_READY");
    assert.deepEqual(stripe?.missingEnvVars, []);
  });

  it("redacts tokens, passwords, and tax IDs in structured logs", () => {
    const entry = createStructuredLogEntry({
      level: "INFO",
      service: "apps/api",
      correlationId: "corr_test_001",
      message: "Auth header Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig received",
      context: {
        userId: "00000000-0000-4000-8000-000000000001",
        password: "super-secret-password",
        accessToken: "jwt-access-token",
        nested: {
          service_role_key: "sbp_secret",
          cpf: "12345678900",
          safeField: "visible",
        },
      },
    });

    assert.equal(entry.correlationId, "corr_test_001");
    assert.match(entry.message, /Bearer \[REDACTED_TOKEN\]/);
    assert.equal(entry.context?.password, "[REDACTED]");
    assert.equal(entry.context?.accessToken, "[REDACTED]");
    const nested = entry.context?.nested as Record<string, unknown>;
    assert.equal(nested.service_role_key, "[REDACTED]");
    assert.equal(nested.cpf, "[REDACTED]");
    assert.equal(nested.safeField, "visible");
    assert.equal(redactSensitiveData(null), null);
  });

  it("verifies Fase T (M23): HTTP security headers, strict CSP without unsafe-eval, CORS allowlist, CSRF guard, rate limiter, anti-mass-assignment, anti-SSRF & storage audit", () => {
    // 1. HTTP security headers & CSP
    const apiHeaders = buildHttpSecurityHeaders({ surface: "api" });
    assert.equal(
      apiHeaders["Strict-Transport-Security"],
      "max-age=63072000; includeSubDomains; preload"
    );
    assert.equal(apiHeaders["X-Content-Type-Options"], "nosniff");
    assert.equal(apiHeaders["X-Frame-Options"], "DENY");
    assert.equal(apiHeaders["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.ok(!apiHeaders["Content-Security-Policy"]?.includes("unsafe-eval"));
    assert.match(apiHeaders["Permissions-Policy"] ?? "", /geolocation=\(\)/);

    const customerHeaders = buildHttpSecurityHeaders({ surface: "customer-web" });
    assert.ok(!customerHeaders["Content-Security-Policy"]?.includes("unsafe-eval"));
    assert.match(
      customerHeaders["Permissions-Policy"] ?? "",
      /geolocation=\(self\)/
    );

    // 2. Strict CORS allowlist (never '*')
    const allowedCors = evaluateCorsRequest({
      originHeader: "https://app.ideliveryfood.com.br",
      method: "OPTIONS",
      rawEnv: { CORS_ALLOWED_ORIGINS: "https://app.ideliveryfood.com.br,https://partner.ideliveryfood.com.br" },
    });
    assert.equal(allowedCors.allowed, true);
    assert.equal(allowedCors.isPreflight, true);
    assert.equal(
      allowedCors.headers["Access-Control-Allow-Origin"],
      "https://app.ideliveryfood.com.br"
    );

    const blockedCors = evaluateCorsRequest({
      originHeader: "https://evil-attacker.example.com",
      method: "POST",
      rawEnv: { CORS_ALLOWED_ORIGINS: "https://app.ideliveryfood.com.br" },
    });
    assert.equal(blockedCors.allowed, false);
    assert.equal(blockedCors.reasonCode, "CORS_ORIGIN_FORBIDDEN");

    // 3. Anti-CSRF for cookie-authenticated mutations
    const cookieHeader =
      "idelivery_access_token=jwt_cookie_val; idelivery_csrf_token=csrf_secret_token_123456";
    const csrfBlockedMissingToken = evaluateCsrfProtection({
      method: "POST",
      cookieHeader,
      originHeader: "https://app.ideliveryfood.com.br",
    });
    assert.equal(csrfBlockedMissingToken.allowed, false);
    assert.equal(csrfBlockedMissingToken.reasonCode, "CSRF_TOKEN_INVALID");

    const csrfAllowed = evaluateCsrfProtection({
      method: "POST",
      cookieHeader,
      originHeader: "https://app.ideliveryfood.com.br",
      csrfTokenHeader: "csrf_secret_token_123456",
    });
    assert.equal(csrfAllowed.allowed, true);
    assert.equal(csrfAllowed.reasonCode, "CSRF_VERIFIED");

    const secureCookie = buildSecureSessionCookieHeader({
      name: "idelivery_access_token",
      value: "token123",
      sameSite: "Strict",
    });
    assert.match(secureCookie, /SameSite=Strict/);
    assert.match(secureCookie, /HttpOnly/);
    assert.match(secureCookie, /Secure/);

    // 4. Sliding window rate limiter
    assert.equal(
      classifyRateLimitRouteBucket("POST", "/v1/logistics/tasks/t1/complete-otp"),
      "OTP_VERIFY"
    );
    const limiter = new SlidingWindowRateLimiter({
      RATE_LIMIT_WINDOW_MS: "60000",
      RATE_LIMIT_OTP_MAX: "2",
    });
    const hit1 = limiter.consume({
      bucket: "OTP_VERIFY",
      clientIp: "203.0.113.10",
      actorId: "courier_1",
      nowMs: 1000,
    });
    assert.equal(hit1.allowed, true);
    assert.equal(hit1.remaining, 1);

    const hit2 = limiter.consume({
      bucket: "OTP_VERIFY",
      clientIp: "203.0.113.10",
      actorId: "courier_1",
      nowMs: 2000,
    });
    assert.equal(hit2.allowed, true);
    assert.equal(hit2.remaining, 0);

    const hit3 = limiter.consume({
      bucket: "OTP_VERIFY",
      clientIp: "203.0.113.10",
      actorId: "courier_1",
      nowMs: 3000,
    });
    assert.equal(hit3.allowed, false);
    assert.ok(hit3.retryAfterSeconds >= 1);

    // 5. Anti-Mass-Assignment validation
    const blockedRole = validatePayloadAgainstMassAssignment({
      pathname: "/v1/me/preferences",
      method: "PATCH",
      body: { locale: "pt-BR", role: "tech_admin" },
    });
    assert.equal(blockedRole.valid, false);
    assert.equal(blockedRole.forbiddenField, "role");

    const blockedPrice = validatePayloadAgainstMassAssignment({
      pathname: "/v1/quotes",
      method: "POST",
      body: {
        storeId: "store_1",
        fulfillmentModality: "PICKUP",
        price_cents: 100,
        cartItems: [],
      },
    });
    assert.equal(blockedPrice.valid, false);
    assert.equal(blockedPrice.forbiddenField, "price_cents");

    // 6. Anti-SSRF webhook URL validation
    for (const badUrl of [
      "http://hooks.partner.example.com/webhook",
      "https://169.254.169.254/latest/meta-data/",
      "https://127.0.0.1:8080/internal",
      "https://10.0.0.15/hook",
      "https://172.16.5.4/hook",
      "https://192.168.1.20/hook",
      "https://localhost:4000/v1/health/live",
      "https://[::1]/hook",
    ]) {
      const ssrf = validateExternalWebhookUrlAgainstSsrf(badUrl);
      assert.equal(ssrf.allowed, false, `Expected SSRF block for ${badUrl}`);
    }
    const validHook = validateExternalWebhookUrlAgainstSsrf(
      "https://hooks.partner.ideliveryfood.com.br/v1/events"
    );
    assert.equal(validHook.allowed, true);

    // 7. Storage upload security
    const badExt = validateStorageUploadSecurity({
      fileName: "xss-payload.svg",
      mimeType: "image/png",
      fileSizeBytes: 2048,
      maxSizeBytes: 5_242_880,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    assert.equal(badExt.valid, false);
    assert.equal(badExt.reasonCode, "STORAGE_DANGEROUS_EXTENSION");

    const mimeMismatch = validateStorageUploadSecurity({
      fileName: "document.pdf",
      mimeType: "image/png",
      fileSizeBytes: 2048,
      maxSizeBytes: 5_242_880,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    assert.equal(mimeMismatch.valid, false);
    assert.equal(mimeMismatch.reasonCode, "STORAGE_EXTENSION_MIME_MISMATCH");
  });
});
