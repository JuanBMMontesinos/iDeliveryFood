import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDeliveryApiClient } from "@ideliveryfood/api-client";
import {
  CustomerCartController,
  buildCustomerCheckoutScreenModel,
  loadCustomerMarketplaceScreen,
} from "../src/index.js";

describe("@ideliveryfood/customer-web — M05 Discovery, Single-Store Cart, Quote & Honest Checkout", () => {
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
    assert.equal(
      screenEn.stores[0]?.description,
      "Dry-aged smash burgers, hand-cut fries, and craft shakes."
    );
    assert.match(screenEn.stores[0]?.minOrderFormatted ?? "", /R\$\s?25\.00/);

    const screenPt = await loadCustomerMarketplaceScreen({ apiClient, locale: "pt-BR" });
    assert.equal(screenPt.localeSelector.activeLocale, "pt-BR");
    assert.equal(screenPt.heading, "Restaurantes Disponíveis (1)");
    assert.equal(
      screenPt.stores[0]?.description,
      "Smash burgers maturados, batatas rústicas e shakes artesanais."
    );
    assert.match(screenPt.stores[0]?.minOrderFormatted ?? "", /R\$\s?25,00/);
  });

  it("enforces single-store cart confirmation before switching stores and blocks checkout when PSP is unconfigured", () => {
    const cart = new CustomerCartController();
    const firstAdd = cart.addItem({
      targetStoreId: "store_201",
      targetStoreName: "Paulista Artisan Burgers",
      item: { productId: "prod_601", quantity: 1, selectedOptions: [] },
      locale: "en",
    });
    assert.equal(firstAdd.added, true);
    assert.equal(firstAdd.confirmationDialog, null);

    const switchAttemptWithoutConfirm = cart.addItem({
      targetStoreId: "store_202",
      targetStoreName: "Tokyo Bay Sushi",
      item: { productId: "prod_603", quantity: 1, selectedOptions: [] },
      confirmSwitchStore: false,
      locale: "pt-BR",
    });
    assert.equal(switchAttemptWithoutConfirm.added, false);
    assert.match(
      switchAttemptWithoutConfirm.confirmationDialog?.title ?? "",
      /Iniciar uma nova sacola em Tokyo Bay Sushi\?/
    );
    assert.equal(cart.getState().storeId, "store_201");

    const switchWithConfirm = cart.addItem({
      targetStoreId: "store_202",
      targetStoreName: "Tokyo Bay Sushi",
      item: { productId: "prod_603", quantity: 1, selectedOptions: [] },
      confirmSwitchStore: true,
      locale: "pt-BR",
    });
    assert.equal(switchWithConfirm.added, true);
    assert.equal(cart.getState().storeId, "store_202");

    // Checkout screen model when PSP is BLOCKED_MISSING_CREDENTIALS
    const checkoutBlocked = buildCustomerCheckoutScreenModel({
      quote: {
        id: "quote_951",
        customerId: "cust_001",
        storeId: "store_201",
        addressId: "addr_801",
        fulfillmentModality: "PLATFORM_DELIVERY",
        promotionCode: "WELCOME10",
        currencyCode: "BRL",
        subtotalCents: 5580,
        addonsCents: 650,
        serviceFeeCents: 312,
        deliveryFeeCents: 690,
        discountCents: 1000,
        totalCents: 6232,
        distanceMeters: 1379,
        estimatedPrepMinutes: 25,
        estimatedDeliveryMinutes: 35,
        itemsSnapshot: [],
        addressSnapshot: null,
        idempotencyKey: "idem_q_001",
        expiresAtIso: "2026-11-03T15:00:00Z",
        consumedAtIso: null,
        createdAtIso: "2026-11-03T12:00:00Z",
      },
      pspReadiness: {
        providerCode: "stripe",
        category: "PSP",
        displayName: "Stripe Brazil",
        isPrimary: true,
        requiredEnvVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
        status: "BLOCKED_MISSING_CREDENTIALS",
        missingEnvVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      },
      locale: "en",
      now: new Date("2026-11-03T12:05:00Z"),
    });

    assert.equal(checkoutBlocked.canSubmitPayment, false);
    assert.match(checkoutBlocked.pspBlockedNotice ?? "", /STRIPE_SECRET_KEY/);
    assert.match(checkoutBlocked.totalFormatted, /R\$\s?62\.32/);
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

    const emptyScreen = await loadCustomerMarketplaceScreen({
      apiClient: emptyClient,
      locale: "en",
    });
    assert.equal(emptyScreen.banner?.kind, "empty");

    const offlineScreen = await loadCustomerMarketplaceScreen({
      apiClient: emptyClient,
      locale: "pt-BR",
      isOffline: true,
    });
    assert.equal(offlineScreen.banner?.kind, "offline");
  });
});
