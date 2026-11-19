import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLanguageSelectorViewModel,
  buildUiScreenStateBanner,
  mapStoreToLocalizedCard,
} from "../src/index.js";

describe("@ideliveryfood/ui-web — Language Selector, Accessibility States & Store Card Mapping Tests", () => {
  it("builds language selector defaulting to 'en' and switchable to 'pt-BR'", () => {
    const enSelector = buildLanguageSelectorViewModel();
    assert.equal(enSelector.activeLocale, "en");
    assert.equal(enSelector.label, "Language");
    assert.equal(enSelector.options.find((o) => o.code === "en")?.isSelected, true);

    const ptSelector = buildLanguageSelectorViewModel("pt-BR");
    assert.equal(ptSelector.activeLocale, "pt-BR");
    assert.equal(ptSelector.label, "Idioma");
    assert.equal(ptSelector.options.find((o) => o.code === "pt-BR")?.isSelected, true);
  });

  it("produces WCAG-compliant state banners for loading, empty, error, offline, forbidden, and mfa_required", () => {
    const loading = buildUiScreenStateBanner({ kind: "loading", locale: "en" });
    assert.equal(loading.role, "status");
    assert.equal(loading.ariaLive, "polite");
    assert.match(loading.message, /Loading live data/);

    const empty = buildUiScreenStateBanner({ kind: "empty", locale: "pt-BR" });
    assert.equal(empty.role, "status");
    assert.equal(empty.ariaLive, "polite");
    assert.match(empty.message, /Nenhum registro encontrado/);

    const offline = buildUiScreenStateBanner({ kind: "offline", locale: "en" });
    assert.equal(offline.role, "alert");
    assert.equal(offline.ariaLive, "assertive");
    assert.match(offline.message, /currently offline/);

    const forbidden = buildUiScreenStateBanner({ kind: "forbidden", locale: "pt-BR" });
    assert.equal(forbidden.role, "alert");
    assert.equal(forbidden.ariaLive, "assertive");
    assert.match(forbidden.message, /Acesso negado/);

    const mfaRequired = buildUiScreenStateBanner({ kind: "mfa_required" });
    assert.equal(mfaRequired.role, "alert");
    assert.equal(mfaRequired.ariaLive, "assertive");
    assert.match(mfaRequired.message, /MFA aal2/);

    const errorPt = buildUiScreenStateBanner({
      kind: "error",
      locale: "pt-BR",
      errorCode: "DB_TIMEOUT",
      correlationId: "corr_99",
    });
    assert.equal(errorPt.role, "alert");
    assert.match(errorPt.message, /DB_TIMEOUT/);
    assert.match(errorPt.message, /corr_99/);

    const errorDefaultParams = buildUiScreenStateBanner({ kind: "error" });
    assert.match(errorDefaultParams.message, /UNKNOWN_ERROR/);
    assert.match(errorDefaultParams.message, /N\/A/);
  });

  it("maps live store records in both 'en' and 'pt-BR' while preserving BRL currency", () => {
    const sampleStore = {
      id: "00000000-0000-4000-8000-000000000201",
      slug: "paulista-burgers-jardins",
      name: "Paulista Artisan Burgers - Jardins",
      descriptionEn: "Dry-aged smash burgers, hand-cut fries, and craft shakes.",
      descriptionPtBr: "Smash burgers maturados, batatas rústicas e shakes artesanais.",
      localizedDescription: "Dry-aged smash burgers, hand-cut fries, and craft shakes.",
      cuisineCategory: "BURGERS",
      isPaused: false,
      timezone: "America/Sao_Paulo",
      city: "São Paulo",
      stateCode: "SP",
      minOrderCents: 2500,
      prepTimeMinMinutes: 20,
      prepTimeMaxMinutes: 35,
      supportedModalities: [
        "PLATFORM_DELIVERY" as const,
        "MERCHANT_DELIVERY" as const,
        "PICKUP" as const,
      ],
    };

    const cardEn = mapStoreToLocalizedCard(sampleStore);
    assert.equal(cardEn.description, sampleStore.descriptionEn);
    assert.match(cardEn.minOrderFormatted, /Min\. order: R\$\s?25\.00/);
    assert.deepEqual(cardEn.modalityBadges, [
      "Platform Delivery",
      "Store Delivery",
      "Pickup at Store",
    ]);

    const cardPt = mapStoreToLocalizedCard(sampleStore, "pt-BR");
    assert.equal(cardPt.description, sampleStore.descriptionPtBr);
    assert.match(cardPt.minOrderFormatted, /Pedido mín\.: R\$\s?25,00/);
    assert.deepEqual(cardPt.modalityBadges, [
      "Entrega Parceira da Plataforma",
      "Entrega Própria da Loja",
      "Retirada na Loja",
    ]);
  });
});
