import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CURRENCY_CODE,
  DEFAULT_LOCALE,
  I18N_MESSAGES,
  OPERATIONAL_TIMEZONE,
  SUPPORTED_LOCALES,
  assertIntegerCents,
  formatBrlCents,
  formatOperationalDuration,
  formatOperationalTimestamp,
  negotiateAcceptLanguageHeader,
  resolveSupportedLocale,
  translateMessage,
  verifyI18nCatalogParity,
} from "../src/index.js";

describe("@ideliveryfood/i18n — Bilingual Catalog Parity, Accept-Language Negotiation, BRL Money & America/Sao_Paulo Formatting", () => {
  it("verifies 100% key parity, non-empty values, and placeholder token parity across I18N_MESSAGES", () => {
    const report = verifyI18nCatalogParity(I18N_MESSAGES);
    assert.equal(report.valid, true);
    assert.ok(report.totalKeys >= 85);
    assert.deepEqual(report.missingInEn, []);
    assert.deepEqual(report.missingInPtBr, []);
    assert.deepEqual(report.emptyTranslations, []);
    assert.deepEqual(report.placeholderMismatches, []);
  });

  it("detects missing keys, empty strings, and placeholder mismatches in custom catalogs", () => {
    const brokenReport = verifyI18nCatalogParity({
      en: {
        "k.both": "Order #{orderNumber} total {amount}",
        "k.only_en": "Only English",
        "k.empty": "   ",
      },
      "pt-BR": {
        "k.both": "Pedido #{orderNumber}",
        "k.only_pt": "Apenas PT",
        "k.empty": "",
      },
    });

    assert.equal(brokenReport.valid, false);
    assert.deepEqual(brokenReport.missingInEn, ["k.only_pt"]);
    assert.deepEqual(brokenReport.missingInPtBr, ["k.only_en"]);
    assert.deepEqual(brokenReport.emptyTranslations, ["en:k.empty", "pt-BR:k.empty"]);
    assert.deepEqual(brokenReport.placeholderMismatches, ["k.both"]);
  });

  it("negotiates HTTP Accept-Language headers with quality weights and defaults to 'en'", () => {
    assert.equal(DEFAULT_LOCALE, "en");
    assert.deepEqual(SUPPORTED_LOCALES, ["en", "pt-BR"]);
    assert.equal(negotiateAcceptLanguageHeader(undefined), "en");
    assert.equal(negotiateAcceptLanguageHeader(""), "en");
    assert.equal(negotiateAcceptLanguageHeader("fr-FR,es;q=0.8"), "en");
    assert.equal(negotiateAcceptLanguageHeader("pt-BR,pt;q=0.9,en-US;q=0.8"), "pt-BR");
    assert.equal(negotiateAcceptLanguageHeader("en-US;q=0.7,pt-BR;q=0.9"), "pt-BR");
    assert.equal(negotiateAcceptLanguageHeader("pt-BR;q=0.4,en-GB;q=0.9"), "en");
    assert.equal(negotiateAcceptLanguageHeader("pt-BR;q=invalid,en;q=0.8"), "en");

    assert.equal(resolveSupportedLocale(null), "en");
    assert.equal(resolveSupportedLocale("pt"), "pt-BR");
    assert.equal(resolveSupportedLocale("pt_BR"), "pt-BR");
    assert.equal(resolveSupportedLocale("en-US"), "en");
  });

  it("interpolates variables and preserves unprovided placeholders safely", () => {
    const enMsg = translateMessage("app.state.error", "en", {
      code: "RATE_LIMIT_EXCEEDED",
      correlationId: "corr_unit_01",
    });
    assert.match(enMsg, /RATE_LIMIT_EXCEEDED/);
    assert.match(enMsg, /corr_unit_01/);

    const ptMsg = translateMessage("app.state.error", "pt-BR", {
      code: "RATE_LIMIT_EXCEEDED",
    });
    assert.match(ptMsg, /RATE_LIMIT_EXCEEDED/);
    assert.match(ptMsg, /\{correlationId\}/);

    const plainEn = translateMessage("app.brand.name");
    assert.equal(plainEn, "iDeliveryFood");
  });

  it("formats BRL integer centavos, America/Sao_Paulo timestamps, and SLA durations in both locales", () => {
    assert.equal(CURRENCY_CODE, "BRL");
    assert.equal(OPERATIONAL_TIMEZONE, "America/Sao_Paulo");

    assert.equal(assertIntegerCents(1250), 1250);
    assert.throws(() => assertIntegerCents(-1), /INVALID_MONETARY_CENTS/);
    assert.throws(() => assertIntegerCents(12.34), /INVALID_MONETARY_CENTS/);

    assert.match(formatBrlCents(6232, "en"), /R\$\s?62\.32/);
    assert.match(formatBrlCents(6232, "pt-BR"), /R\$\s?62,32/);

    const dateInput = new Date("2026-11-19T15:45:00.000Z");
    assert.match(formatOperationalTimestamp(dateInput, "en"), /12:45/);
    assert.match(formatOperationalTimestamp("2026-11-19T15:45:00.000Z", "pt-BR"), /12:45/);
    assert.throws(() => formatOperationalTimestamp("not-a-date"), /INVALID_TIMESTAMP/);

    assert.equal(formatOperationalDuration(125, "en"), "2m 5s remaining");
    assert.equal(formatOperationalDuration(125, "pt-BR"), "2m 5s restantes");
    assert.equal(formatOperationalDuration(-90, "en"), "SLA breached by 1m 30s");
    assert.equal(formatOperationalDuration(-90, "pt-BR"), "SLA estourado há 1m 30s");
    assert.throws(() => formatOperationalDuration(Number.NaN), /INVALID_DURATION_SECONDS/);
  });
});
