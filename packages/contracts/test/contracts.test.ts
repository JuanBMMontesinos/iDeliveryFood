import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CURRENCY_CODE,
  DEFAULT_LOCALE,
  I18N_MESSAGES,
  OPERATIONAL_TIMEZONE,
  SUPPORTED_LOCALES,
  assertIntegerCents,
  formatBrlCents,
  formatOperationalTimestamp,
  resolveSupportedLocale,
  translateMessage,
  type I18nMessageKey,
} from "../src/index.js";

describe("@ideliveryfood/contracts — i18n, Money, Timezone & OpenAPI Contract Tests", () => {
  it("enforces English ('en') as the default locale and supports 'pt-BR'", () => {
    assert.equal(DEFAULT_LOCALE, "en");
    assert.deepEqual(SUPPORTED_LOCALES, ["en", "pt-BR"]);
    assert.equal(resolveSupportedLocale(undefined), "en");
    assert.equal(resolveSupportedLocale("en-US"), "en");
    assert.equal(resolveSupportedLocale("pt-BR"), "pt-BR");
    assert.equal(resolveSupportedLocale("pt_br"), "pt-BR");
  });

  it("verifies 100% key parity and placeholder parity between 'en' and 'pt-BR' catalogs", () => {
    const enKeys = Object.keys(I18N_MESSAGES.en).sort();
    const ptBrKeys = Object.keys(I18N_MESSAGES["pt-BR"]).sort();
    assert.deepEqual(enKeys, ptBrKeys, "en and pt-BR catalogs must have identical keys");

    const placeholderRegex = /\{[a-zA-Z0-9_]+\}/g;
    for (const key of enKeys as I18nMessageKey[]) {
      const enVal = I18N_MESSAGES.en[key];
      const ptVal = I18N_MESSAGES["pt-BR"][key];
      assert.ok(enVal.trim().length > 0, `Empty 'en' translation for ${key}`);
      assert.ok(ptVal.trim().length > 0, `Empty 'pt-BR' translation for ${key}`);

      const enPlaceholders = (enVal.match(placeholderRegex) ?? []).sort();
      const ptPlaceholders = (ptVal.match(placeholderRegex) ?? []).sort();
      assert.deepEqual(
        enPlaceholders,
        ptPlaceholders,
        `Placeholder mismatch in key '${key}' between en and pt-BR`
      );
    }
  });

  it("interpolates parameters in both 'en' and 'pt-BR' without mutating currency or timezone", () => {
    const enError = translateMessage("app.state.error", "en", {
      code: "AUTH_FORBIDDEN",
      correlationId: "corr_123",
    });
    const ptError = translateMessage("app.state.error", "pt-BR", {
      code: "AUTH_FORBIDDEN",
      correlationId: "corr_123",
    });

    assert.match(enError, /AUTH_FORBIDDEN/);
    assert.match(enError, /corr_123/);
    assert.match(ptError, /AUTH_FORBIDDEN/);
    assert.match(ptError, /corr_123/);

    assert.equal(CURRENCY_CODE, "BRL");
    assert.equal(OPERATIONAL_TIMEZONE, "America/Sao_Paulo");

    const brlEn = formatBrlCents(3890, "en");
    const brlPt = formatBrlCents(3890, "pt-BR");
    assert.match(brlEn, /R\$\s?38\.90/);
    assert.match(brlPt, /R\$\s?38,90/);

    const tsEn = formatOperationalTimestamp("2026-11-03T15:30:00Z", "en");
    const tsPt = formatOperationalTimestamp("2026-11-03T15:30:00Z", "pt-BR");
    assert.match(tsEn, /12:30/);
    assert.match(tsPt, /12:30/);
  });

  it("rejects floating-point or negative centavos values", () => {
    assert.equal(assertIntegerCents(0), 0);
    assert.equal(assertIntegerCents(6232), 6232);
    assert.throws(() => assertIntegerCents(38.9), /INVALID_MONETARY_CENTS/);
    assert.throws(() => assertIntegerCents(-100), /INVALID_MONETARY_CENTS/);
  });

  it("verifies OpenAPI 3.1 specification exists and defines mandatory Fase A + Fase B /v1 endpoints", () => {
    const specPath = path.resolve(process.cwd(), "openapi/v1.yaml");
    assert.equal(fs.existsSync(specPath), true, "openapi/v1.yaml must exist");
    const content = fs.readFileSync(specPath, "utf8");
    assert.match(content, /openapi:\s*3\.1\.0/);
    assert.match(content, /\/health\/live:/);
    assert.match(content, /\/health\/ready:/);
    assert.match(content, /\/system\/providers:/);
    assert.match(content, /\/me:/);
    assert.match(content, /\/me\/preferences:/);
    assert.match(content, /\/me\/addresses:/);
    assert.match(content, /\/organizations\/\{orgId\}\/members:/);
    assert.match(content, /\/organizations\/\{orgId\}\/units-summary:/);
    assert.match(content, /\/organizations\/\{orgId\}\/catalog-batch:/);
    assert.match(content, /\/invitations:/);
    assert.match(content, /\/onboarding\/approvals:/);
    assert.match(content, /\/stores:/);
    assert.match(content, /\/stores\/\{storeId\}\/catalog:/);
    assert.match(content, /\/stores\/\{storeId\}\/availability:/);
    assert.match(content, /\/quotes:/);
    assert.match(content, /\/orders:/);
    assert.match(content, /\/orders\/\{orderId\}\/commands:/);
    assert.match(content, /\/orders\/\{orderId\}\/events:/);
    assert.match(content, /\/payments\/attempts:/);
    assert.match(content, /\/webhooks\/psp\/\{providerCode\}:/);
    assert.match(content, /\/refunds:/);
  });
});
