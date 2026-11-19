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

    const invalidFileName = validateStorageUploadSecurity({
      fileName: "../traversal.png",
      mimeType: "image/png",
      fileSizeBytes: 2048,
      maxSizeBytes: 5_242_880,
      allowedMimeTypes: ["image/png"],
    });
    assert.equal(invalidFileName.valid, false);
    assert.equal(invalidFileName.reasonCode, "STORAGE_INVALID_FILENAME");

    const invalidMime = validateStorageUploadSecurity({
      fileName: "photo.png",
      mimeType: "application/zip",
      fileSizeBytes: 2048,
      maxSizeBytes: 5_242_880,
      allowedMimeTypes: ["image/png"],
    });
    assert.equal(invalidMime.valid, false);
    assert.equal(invalidMime.reasonCode, "STORAGE_INVALID_MIME_TYPE");

    const tooLarge = validateStorageUploadSecurity({
      fileName: "photo.png",
      mimeType: "image/png",
      fileSizeBytes: 10_000_000,
      maxSizeBytes: 5_242_880,
      allowedMimeTypes: ["image/png"],
    });
    assert.equal(tooLarge.valid, false);
    assert.equal(tooLarge.reasonCode, "STORAGE_FILE_TOO_LARGE");

    const validStorage = validateStorageUploadSecurity({
      fileName: "photo.png",
      mimeType: "image/png",
      fileSizeBytes: 2048,
      maxSizeBytes: 5_242_880,
      allowedMimeTypes: ["image/png"],
    });
    assert.equal(validStorage.valid, true);
    assert.equal(validStorage.reasonCode, "VALID");
  });

  it("covers all validation error branches in env, CORS, CSRF, rate limiter buckets, mass-assignment, and IPv4/IPv6 SSRF guards", () => {
    // 1. validatePublicWebEnv & validateServerEnv errors
    assert.throws(
      () =>
        validatePublicWebEnv({
          NEXT_PUBLIC_SUPABASE_URL: "http://insecure.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon_public_key_placeholder_12345",
        }),
      /NEXT_PUBLIC_SUPABASE_URL must be a valid https:\/\/ URL/
    );
    assert.throws(
      () =>
        validatePublicWebEnv({
          NEXT_PUBLIC_SUPABASE_URL: "https://dwsoochnfxldfvcaijie.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "short",
        }),
      /NEXT_PUBLIC_SUPABASE_ANON_KEY is required/
    );
    assert.throws(
      () =>
        validateServerEnv({
          SUPABASE_URL: "https://dwsoochnfxldfvcaijie.supabase.co",
          SUPABASE_ANON_KEY: "anon_public_key_placeholder_12345",
          API_PORT: "99999",
        }),
      /API_PORT must be a valid TCP port/
    );
    const prodServerCfg = validateServerEnv({
      SUPABASE_URL: "https://dwsoochnfxldfvcaijie.supabase.co",
      SUPABASE_ANON_KEY: "anon_public_key_placeholder_12345",
      APP_ENV: "production",
      SUPABASE_SERVICE_ROLE_KEY: "srv_key",
      SUPABASE_JWT_SECRET: "jwt_sec",
    });
    assert.equal(prodServerCfg.appEnv, "production");
    assert.equal(prodServerCfg.supabaseServiceRoleKey, "srv_key");

    // 2. CORS edge branches (no origin, wildcard '*', null origin, malformed URL, non-preflight GET)
    const noOriginCors = evaluateCorsRequest({ method: "GET" });
    assert.equal(noOriginCors.allowed, true);
    assert.equal(noOriginCors.isPreflight, false);

    const starCors = evaluateCorsRequest({ originHeader: "*", method: "OPTIONS" });
    assert.equal(starCors.allowed, false);
    assert.equal(starCors.reasonCode, "CORS_ORIGIN_FORBIDDEN");

    const malformedCors = evaluateCorsRequest({
      originHeader: "not-a-valid-origin",
      method: "GET",
      rawEnv: { CORS_ALLOWED_ORIGINS: "*,null,invalid-url,https://app.ideliveryfood.com.br" },
    });
    assert.equal(malformedCors.allowed, false);

    // 3. CSRF edge branches (SAFE_METHOD, STATELESS_AUTH, Referer fallback, origin mismatch, length mismatch)
    assert.equal(
      evaluateCsrfProtection({ method: "GET" }).reasonCode,
      "SAFE_METHOD"
    );
    assert.equal(
      evaluateCsrfProtection({
        method: "POST",
        authorizationHeader: "Bearer eyJ.token",
        cookieHeader: "idelivery_access_token=abc",
      }).reasonCode,
      "STATELESS_AUTH"
    );
    assert.equal(
      evaluateCsrfProtection({
        method: "POST",
        cookieHeader: "sb-access-token=abc; idelivery_csrf_token=csrf_secret_token_123456",
        refererHeader: "https://evil.example.com/page",
      }).reasonCode,
      "CSRF_ORIGIN_MISMATCH"
    );
    assert.equal(
      evaluateCsrfProtection({
        method: "POST",
        cookieHeader: "session_id=abc; idelivery_csrf_token=csrf_secret_token_123456",
        refererHeader: "not-a-url",
      }).reasonCode,
      "CSRF_ORIGIN_MISMATCH"
    );
    assert.equal(
      evaluateCsrfProtection({
        method: "POST",
        cookieHeader: "session_id=abc; idelivery_csrf_token=csrf_secret_token_123456",
        refererHeader: "https://app.ideliveryfood.com.br/checkout",
        csrfTokenHeader: "csrf_secret_token_999999",
      }).reasonCode,
      "CSRF_TOKEN_INVALID"
    );

    const laxCookie = buildSecureSessionCookieHeader({
      name: "csrf",
      value: "val",
      maxAgeSeconds: 3600,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    });
    assert.match(laxCookie, /Max-Age=3600/);
    assert.match(laxCookie, /SameSite=Lax/);

    // 4. Rate limiter route buckets & global override
    assert.equal(classifyRateLimitRouteBucket("GET", "/v1/analytics/export"), "DATA_EXPORT");
    assert.equal(classifyRateLimitRouteBucket("POST", "/v1/auth/login"), "AUTH");
    assert.equal(classifyRateLimitRouteBucket("POST", "/v1/quotes"), "QUOTES_ORDERS");
    assert.equal(classifyRateLimitRouteBucket("POST", "/v1/webhooks/psp/stripe"), "PSP_WEBHOOKS");
    assert.equal(classifyRateLimitRouteBucket("POST", "/v1/admin/staff-scopes"), "ADMIN_GOVERNANCE");
    assert.equal(classifyRateLimitRouteBucket("GET", "/v1/stores"), "DEFAULT");

    const globalLimiter = new SlidingWindowRateLimiter({
      RATE_LIMIT_WINDOW_MS: "invalid",
      RATE_LIMIT_MAX_REQUESTS: "5",
    });
    const anonConsume = globalLimiter.consume({
      bucket: "DEFAULT",
      clientIp: "198.51.100.1",
    });
    assert.equal(anonConsume.allowed, true);
    assert.equal(anonConsume.limit, 5);

    // 5. Mass assignment edge branches
    assert.equal(
      validatePayloadAgainstMassAssignment({
        pathname: "/v1/stores",
        method: "GET",
        body: { is_admin: true },
      }).valid,
      true
    );
    assert.equal(
      validatePayloadAgainstMassAssignment({
        pathname: "/v1/orders",
        method: "POST",
        body: { quoteId: "q1", unknownExtraField: "forbidden" },
      }).valid,
      false
    );
    assert.equal(
      validatePayloadAgainstMassAssignment({
        pathname: "/v1/quotes",
        method: "POST",
        body: {
          storeId: "s1",
          fulfillmentModality: "PICKUP",
          cartItems: [{ productId: "p1", quantity: 1, unexpectedItemProp: 123 }],
        },
      }).valid,
      false
    );
    assert.equal(
      validatePayloadAgainstMassAssignment({
        pathname: "/v1/quotes",
        method: "POST",
        body: {
          storeId: "s1",
          fulfillmentModality: "PICKUP",
          cartItems: [{ productId: "p1", quantity: 1, is_super_admin: true }],
        },
      }).valid,
      false
    );
    assert.equal(
      validatePayloadAgainstMassAssignment({
        pathname: "/v1/admin/staff-scopes",
        method: "POST",
        body: { targetUserId: "u1", role: "support", organizationId: "org1" },
      }).valid,
      true
    );
    assert.equal(
      validatePayloadAgainstMassAssignment({
        pathname: "/v1/support/cases/c1/status",
        method: "PATCH",
        body: { status: "IN_PROGRESS", nested: { organization_id: "forbidden_here" } },
      }).valid,
      false
    );

    // 6. SSRF edge branches (invalid URL, embedded credentials, numeric IP, CGNAT, multicast, IPv6 mapped/unique-local/link-local/public)
    assert.equal(
      validateExternalWebhookUrlAgainstSsrf("not a url").reasonCode,
      "SSRF_INVALID_URL"
    );
    assert.equal(
      validateExternalWebhookUrlAgainstSsrf("https://user:pass@hooks.example.com/hook").reasonCode,
      "SSRF_EMBEDDED_CREDENTIALS_FORBIDDEN"
    );
    assert.equal(
      validateExternalWebhookUrlAgainstSsrf("https://metadata.google.internal/computeMetadata/v1/").reasonCode,
      "SSRF_INTERNAL_HOST_FORBIDDEN"
    );
    assert.equal(
      validateExternalWebhookUrlAgainstSsrf("https://2130706433/hook").reasonCode,
      "SSRF_PRIVATE_OR_METADATA_IP_FORBIDDEN"
    );
    for (const privIp of [
      "https://0.0.0.0/hook",
      "https://100.64.10.20/hook",
      "https://224.0.0.1/hook",
      "https://[::ffff:127.0.0.1]/hook",
      "https://[fc00::1]/hook",
      "https://[fe80::1]/hook",
    ]) {
      assert.equal(
        validateExternalWebhookUrlAgainstSsrf(privIp).allowed,
        false,
        `Expected SSRF block for ${privIp}`
      );
    }
    assert.equal(
      validateExternalWebhookUrlAgainstSsrf("https://93.184.216.34/webhook").allowed,
      true
    );
    assert.equal(
      validateExternalWebhookUrlAgainstSsrf("https://[2606:2800:220:1:248:1893:25c8:1946]/webhook").allowed,
      true
    );
  });
});
