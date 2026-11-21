import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CURRENCY_CODE,
  DEFAULT_LOCALE,
  I18N_MESSAGES,
  OPERATIONAL_TIMEZONE,
  SUPPORTED_LOCALES,
  formatBrlCents,
  formatOperationalTimestamp,
} from "../../packages/contracts/dist/src/index.js";
import {
  buildLanguageSelectorViewModel,
  buildUiScreenStateBanner,
} from "../../packages/ui-web/dist/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

function collectFilesRecursively(dirPath, extensions) {
  if (!fs.existsSync(dirPath)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", ".next", "dist", "build"].includes(entry.name)) {
        results.push(...collectFilesRecursively(full, extensions));
      }
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

describe("Fase X (M24 Parte 3) — Jornada E2E 4: Acessibilidade WCAG 2.1 AA, Semântica ARIA, Navegação por Teclado e Paridade Bilíngue (en/pt-BR) nos 3 Portais Web e 4 Apps Mobile Nativos", () => {
  it("1. valida descritores WCAG 2.1 AA (role='status' | 'alert', aria-live='polite' | 'assertive') e seletor de idioma em en e pt-BR no @ideliveryfood/ui-web", () => {
    const politeStates = ["loading", "empty"];
    for (const kind of politeStates) {
      const enBanner = buildUiScreenStateBanner({ kind, locale: "en" });
      const ptBanner = buildUiScreenStateBanner({ kind, locale: "pt-BR" });
      assert.equal(enBanner.role, "status");
      assert.equal(enBanner.ariaLive, "polite");
      assert.ok(enBanner.message.length > 0);
      assert.equal(ptBanner.role, "status");
      assert.equal(ptBanner.ariaLive, "polite");
      assert.ok(ptBanner.message.length > 0);
      assert.notEqual(enBanner.message, ptBanner.message);
    }

    const assertiveStates = ["offline", "forbidden", "mfa_required", "error"];
    for (const kind of assertiveStates) {
      const enBanner = buildUiScreenStateBanner({
        kind,
        locale: "en",
        errorCode: "E2E_A11Y_CHECK",
        correlationId: "corr_e2e_a11y",
      });
      const ptBanner = buildUiScreenStateBanner({
        kind,
        locale: "pt-BR",
        errorCode: "E2E_A11Y_CHECK",
        correlationId: "corr_e2e_a11y",
      });
      assert.equal(enBanner.role, "alert");
      assert.equal(enBanner.ariaLive, "assertive");
      assert.equal(ptBanner.role, "alert");
      assert.equal(ptBanner.ariaLive, "assertive");
    }

    const selectorEn = buildLanguageSelectorViewModel("en");
    const selectorPt = buildLanguageSelectorViewModel("pt-BR");
    assert.equal(selectorEn.activeLocale, "en");
    assert.equal(selectorPt.activeLocale, "pt-BR");
    assert.equal(selectorEn.options.length, 2);
    assert.equal(selectorPt.options.length, 2);
  });

  it("2. verifica landmarks semânticos HTML5, atributos ARIA e controles de teclado/foco nos 3 portais Next.js (customer-web, partner-web, admin-web)", () => {
    const portals = [
      { name: "customer-web", dir: path.join(REPO_ROOT, "apps/customer-web/src") },
      { name: "partner-web", dir: path.join(REPO_ROOT, "apps/partner-web/src") },
      { name: "admin-web", dir: path.join(REPO_ROOT, "apps/admin-web/src") },
    ];

    for (const portal of portals) {
      const tsxFiles = collectFilesRecursively(portal.dir, [".tsx", ".ts"]);
      assert.ok(
        tsxFiles.length >= 5,
        `Portal ${portal.name} must contain Next.js App Router pages/components (found ${tsxFiles.length})`
      );

      const combinedSource = tsxFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");

      // Semantic HTML landmarks & WCAG ARIA attributes
      assert.match(
        combinedSource,
        /<main\b|<header\b|<nav\b/,
        `Portal ${portal.name} must render semantic HTML5 landmarks (<main>, <header>, <nav>)`
      );
      assert.match(
        combinedSource,
        /aria-live|role=["'](?:status|alert|dialog|region|navigation|tablist|tab)["']|aria-label/,
        `Portal ${portal.name} must include explicit WCAG ARIA attributes (aria-live, role, aria-label)`
      );
      assert.match(
        combinedSource,
        /<button\b|<form\b|<input\b|<select\b|<label\b|<a\b/,
        `Portal ${portal.name} must use native keyboard-accessible interactive controls`
      );
    }
  });

  it("3. verifica acessibilidade nativa (contentDescription no Android Jetpack Compose e accessibilityLabel no iOS SwiftUI) nos 4 apps mobile", () => {
    const androidApps = [
      { name: "customer-android", dir: path.join(REPO_ROOT, "apps/customer-android/src/main") },
      { name: "courier-android", dir: path.join(REPO_ROOT, "apps/courier-android/src/main") },
    ];
    for (const app of androidApps) {
      const ktFiles = collectFilesRecursively(app.dir, [".kt"]);
      assert.ok(ktFiles.length >= 5, `${app.name} must contain Kotlin Compose screens`);
      const combinedKt = ktFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
      assert.match(
        combinedKt,
        /contentDescription\s*=/,
        `${app.name} Jetpack Compose screens must provide contentDescription for TalkBack screen readers`
      );
    }

    const iosApps = [
      { name: "customer-ios", dir: path.join(REPO_ROOT, "apps/customer-ios/Sources") },
      { name: "courier-ios", dir: path.join(REPO_ROOT, "apps/courier-ios/Sources") },
    ];
    for (const app of iosApps) {
      const swiftFiles = collectFilesRecursively(app.dir, [".swift"]);
      assert.ok(swiftFiles.length >= 5, `${app.name} must contain SwiftUI views`);
      const combinedSwift = swiftFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
      assert.match(
        combinedSwift,
        /\.accessibilityLabel\(/,
        `${app.name} SwiftUI views must provide .accessibilityLabel(...) for VoiceOver screen readers`
      );
    }
  });

  it("4. garante paridade 100% de chaves i18n (en padrão, pt-BR selecionável), moeda invariável BRL em centavos e fuso America/Sao_Paulo", () => {
    assert.equal(DEFAULT_LOCALE, "en");
    assert.deepEqual(SUPPORTED_LOCALES, ["en", "pt-BR"]);
    assert.equal(CURRENCY_CODE, "BRL");
    assert.equal(OPERATIONAL_TIMEZONE, "America/Sao_Paulo");

    const enKeys = Object.keys(I18N_MESSAGES.en).sort();
    const ptKeys = Object.keys(I18N_MESSAGES["pt-BR"]).sort();
    assert.deepEqual(enKeys, ptKeys);

    assert.match(formatBrlCents(6232, "en"), /R\$\s?62\.32/);
    assert.match(formatBrlCents(6232, "pt-BR"), /R\$\s?62,32/);
    assert.match(formatOperationalTimestamp("2026-11-03T15:30:00Z", "en"), /12:30/);
    assert.match(formatOperationalTimestamp("2026-11-03T15:30:00Z", "pt-BR"), /12:30/);
  });
});
