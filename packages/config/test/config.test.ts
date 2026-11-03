import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createStructuredLogEntry,
  inspectProviderReadiness,
  redactSensitiveData,
  validatePublicWebEnv,
  validateServerEnv,
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
});
