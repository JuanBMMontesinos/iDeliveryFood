import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDeliveryApiClient } from "@ideliveryfood/api-client";
import { loadCustomerMarketplaceScreen } from "../src/index.js";

describe("@ideliveryfood/customer-web — Live API Store Discovery, i18n Switch & State Banners", () => {
  it("loads published stores in English ('en' default) and switches to 'pt-BR' without changing BRL currency", async () => {
    const apiClient = new IDeliveryApiClient({
      baseUrl: "http://localhost:4000/v1",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              {
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
                supportedModalities: ["PLATFORM_DELIVERY", "PICKUP"],
              },
            ],
            meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    });

    const screenEn = await loadCustomerMarketplaceScreen({ apiClient });
    assert.equal(screenEn.localeSelector.activeLocale, "en");
    assert.equal(screenEn.heading, "Available Restaurants (1)");
    assert.equal(screenEn.stores[0]?.description, "Dry-aged smash burgers, hand-cut fries, and craft shakes.");
    assert.match(screenEn.stores[0]?.minOrderFormatted ?? "", /R\$\s?25\.00/);

    const screenPt = await loadCustomerMarketplaceScreen({ apiClient, locale: "pt-BR" });
    assert.equal(screenPt.localeSelector.activeLocale, "pt-BR");
    assert.equal(screenPt.heading, "Restaurantes Disponíveis (1)");
    assert.equal(screenPt.stores[0]?.description, "Smash burgers maturados, batatas rústicas e shakes artesanais.");
    assert.match(screenPt.stores[0]?.minOrderFormatted ?? "", /R\$\s?25,00/);
  });

  it("renders accessible empty and offline banners when appropriate", async () => {
    const emptyClient = new IDeliveryApiClient({
      baseUrl: "http://localhost:4000/v1",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [],
            meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    });

    const emptyScreen = await loadCustomerMarketplaceScreen({ apiClient: emptyClient, locale: "en" });
    assert.equal(emptyScreen.banner?.kind, "empty");

    const offlineScreen = await loadCustomerMarketplaceScreen({
      apiClient: emptyClient,
      locale: "pt-BR",
      isOffline: true,
    });
    assert.equal(offlineScreen.banner?.kind, "offline");
  });
});
