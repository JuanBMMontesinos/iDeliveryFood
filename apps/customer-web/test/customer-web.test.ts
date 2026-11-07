import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { IDeliveryApiClient } from "@ideliveryfood/api-client";
import {
  createApiServer,
  createSupabasePostgresRepository,
  signSupabaseHs256Jwt,
} from "@ideliveryfood/api";
import {
  CustomerCartController,
  buildCustomerAuthRecoverScreenModel,
  buildCustomerAuthSignInScreenModel,
  buildCustomerAuthSignUpScreenModel,
  buildCustomerCheckoutScreenModel,
  createCustomerWebServer,
  loadCustomerMarketplaceScreen,
  renderCustomerAuthRecoverHtml,
  renderCustomerAuthSignInHtml,
  renderCustomerAuthSignUpHtml,
  validateCustomerProductOptionSelections,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveConnectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.resolve(__dirname, "../../../../.env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DATABASE_URL=")) {
        return trimmed.slice("DATABASE_URL=".length).trim();
      }
    }
  }
  throw new Error("DATABASE_URL is required for live Customer Web integration tests.");
}

describe("@ideliveryfood/customer-web — M05 Discovery, Single-Store Cart, Quote, 11 App Router Routes & PWA", () => {
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

  it("enforces single-store cart confirmation, quantity updates, and blocks checkout when PSP is unconfigured", () => {
    const cart = new CustomerCartController();
    const firstAdd = cart.addItem({
      targetStoreId: "store_201",
      targetStoreName: "Paulista Artisan Burgers",
      item: { productId: "prod_601", quantity: 1, selectedOptions: [] },
      locale: "en",
    });
    assert.equal(firstAdd.added, true);
    assert.equal(firstAdd.confirmationDialog, null);

    cart.updateItemQuantity("prod_601", 3);
    assert.equal(cart.getState().items[0]?.quantity, 3);

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

    cart.removeItem("prod_603");
    assert.equal(cart.getState().storeId, null);
    assert.equal(cart.getState().items.length, 0);

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

  it("validates product option group min/max rules and renders Auth screens in both en and pt-BR", () => {
    const product = {
      id: "prod_601",
      storeId: "store_201",
      categoryId: "cat_501",
      sku: "PAB-SMASH-01",
      nameEn: "Double Paulista Truffle Smash",
      namePtBr: "Duplo Smash Paulista Trufado",
      localizedName: "Double Paulista Truffle Smash",
      descriptionEn: "Desc",
      descriptionPtBr: "Desc",
      localizedDescription: "Desc",
      priceCents: 3890,
      isAvailable: true,
      isPaused: false,
      maxPerOrder: 10,
      unitOfMeasure: "UNIT" as const,
      optionGroups: [
        {
          id: "grp_required",
          productId: "prod_601",
          nameEn: "Meat Point",
          namePtBr: "Ponto da Carne",
          localizedName: "Meat Point",
          minSelections: 1,
          maxSelections: 1,
          sortOrder: 1,
          options: [],
        },
      ],
    };

    const invalidResult = validateCustomerProductOptionSelections({
      product,
      selectedOptions: [],
      locale: "en",
    });
    assert.equal(invalidResult.valid, false);
    assert.equal(invalidResult.violatedGroupId, "grp_required");
    assert.match(invalidResult.message ?? "", /Required \(1 to 1\)/);

    const validResult = validateCustomerProductOptionSelections({
      product,
      selectedOptions: [{ optionGroupId: "grp_required", optionId: "opt_1", quantity: 1 }],
      locale: "en",
    });
    assert.equal(validResult.valid, true);

    const loginHtml = renderCustomerAuthSignInHtml(
      buildCustomerAuthSignInScreenModel({
        locale: "en",
        supabaseUrl: "https://dwsoochnfxldfvcaijie.supabase.co",
      })
    );
    assert.match(loginHtml, /Sign in to your account/);
    assert.match(loginHtml, /manifest\.webmanifest/);

    const signupHtml = renderCustomerAuthSignUpHtml(
      buildCustomerAuthSignUpScreenModel({
        locale: "pt-BR",
        supabaseUrl: "https://dwsoochnfxldfvcaijie.supabase.co",
      })
    );
    assert.match(signupHtml, /Crie sua conta/);

    const recoverHtml = renderCustomerAuthRecoverHtml(
      buildCustomerAuthRecoverScreenModel({
        locale: "pt-BR",
        supabaseUrl: "https://dwsoochnfxldfvcaijie.supabase.co",
      })
    );
    assert.match(recoverHtml, /Recuperar sua senha/);
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

  describe("Live End-to-End Customer Web Server + Supabase PostgreSQL Integration (All 11 Routes + PWA)", () => {
    const jwtSecret = "customer_web_live_test_jwt_secret_key_2026";
    let repository: ReturnType<typeof createSupabasePostgresRepository>;
    let apiServer: ReturnType<typeof createApiServer>;
    let webServer: ReturnType<typeof createCustomerWebServer>;
    let apiBaseUrl = "";
    let webBaseUrl = "";
    let cartController: CustomerCartController;

    before(async () => {
      repository = createSupabasePostgresRepository({
        connectionString: resolveConnectionString(),
        isTestData: true,
      });
      apiServer = createApiServer({
        repository,
        env: {
          ...process.env,
          NODE_ENV: "test",
          SUPABASE_JWT_SECRET: jwtSecret,
        },
        allowTestActorHeaders: false,
      });
      await new Promise<void>((resolve) => apiServer.listen(0, resolve));
      const apiAddr = apiServer.address();
      const apiPort = typeof apiAddr === "object" && apiAddr ? apiAddr.port : 0;
      apiBaseUrl = `http://127.0.0.1:${apiPort}/v1`;

      const aliceToken = signSupabaseHs256Jwt(
        {
          sub: "00000000-0000-4000-8000-000000000001",
          role: "authenticated",
          aal: "aal1",
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        jwtSecret
      );

      const apiClient = new IDeliveryApiClient({
        baseUrl: apiBaseUrl,
        getAccessToken: () => aliceToken,
      });

      cartController = new CustomerCartController();
      webServer = createCustomerWebServer({
        apiClient,
        cartController,
      });
      await new Promise<void>((resolve) => webServer.listen(0, resolve));
      const webAddr = webServer.address();
      const webPort = typeof webAddr === "object" && webAddr ? webAddr.port : 0;
      webBaseUrl = `http://127.0.0.1:${webPort}`;
    });

    after(async () => {
      await new Promise<void>((resolve) => webServer.close(() => resolve()));
      await new Promise<void>((resolve) => apiServer.close(() => resolve()));
      await repository.close();
    });

    it("serves PWA manifest.webmanifest and sw.js, and renders all 11 App Router routes from live Supabase data", async () => {
      // 1. PWA Manifest & Service Worker
      const manifestRes = await fetch(`${webBaseUrl}/manifest.webmanifest`);
      assert.equal(manifestRes.status, 200);
      const manifestJson = (await manifestRes.json()) as { short_name: string; display: string };
      assert.equal(manifestJson.short_name, "iDeliveryFood");
      assert.equal(manifestJson.display, "standalone");

      const swRes = await fetch(`${webBaseUrl}/sw.js`);
      assert.equal(swRes.status, 200);
      const swText = await swRes.text();
      assert.match(swText, /PURGE_AUTH_CACHE/);
      assert.match(swText, /url\.pathname\.startsWith\("\/v1\/"\)/);

      // 2. Route /: Discovery Home (from live Supabase published_stores_v)
      const homeRes = await fetch(`${webBaseUrl}/?locale=pt-BR`);
      assert.equal(homeRes.status, 200);
      const homeHtml = await homeRes.text();
      assert.match(homeHtml, /Paulista Artisan Burgers - Jardins/);
      assert.match(homeHtml, /Tokyo Bay Sushi - Pinheiros/);

      // 3. Routes /auth/login, /auth/signup, /auth/recover
      const loginRes = await fetch(`${webBaseUrl}/auth/login?locale=en`);
      assert.equal(loginRes.status, 200);
      const signupRes = await fetch(`${webBaseUrl}/auth/signup?locale=pt-BR`);
      assert.equal(signupRes.status, 200);
      const recoverRes = await fetch(`${webBaseUrl}/auth/recover?locale=en`);
      assert.equal(recoverRes.status, 200);

      // 4. Route /addresses (Alice's address + live store coverage evaluation)
      const addrRes = await fetch(
        `${webBaseUrl}/addresses?locale=pt-BR&storeId=00000000-0000-4000-8000-000000000201`
      );
      assert.equal(addrRes.status, 200);
      const addrHtml = await addrRes.text();
      assert.match(addrHtml, /Rua Oscar Freire/);
      assert.match(addrHtml, /Área atendida/);

      // 5. Route /stores/[slug] (Paulista Burgers catalog from live Supabase)
      const storeRes = await fetch(
        `${webBaseUrl}/stores/paulista-burgers-jardins?locale=pt-BR`
      );
      assert.equal(storeRes.status, 200);
      const storeHtml = await storeRes.text();
      assert.match(storeHtml, /Duplo Smash Paulista Trufado/);
      assert.match(storeHtml, /Bacon Defumado Artesanal/);

      // 6. Routes /cart and /checkout (with real server quote in BRL cents)
      cartController.addItem({
        targetStoreId: "00000000-0000-4000-8000-000000000201",
        targetStoreName: "Paulista Artisan Burgers - Jardins",
        item: {
          productId: "00000000-0000-4000-8000-000000000601",
          quantity: 1,
          selectedOptions: [
            {
              optionGroupId: "00000000-0000-4000-8000-000000000701",
              optionId: "00000000-0000-4000-8000-000000000751",
              quantity: 1,
            },
          ],
        },
      });
      const cartRes = await fetch(`${webBaseUrl}/cart?locale=pt-BR`);
      assert.equal(cartRes.status, 200);
      const cartHtml = await cartRes.text();
      assert.match(cartHtml, /Minha Sacola — Paulista Artisan Burgers - Jardins/);

      const checkoutRes = await fetch(`${webBaseUrl}/checkout?locale=en`);
      assert.equal(checkoutRes.status, 200);
      const checkoutHtml = await checkoutRes.text();
      assert.match(checkoutHtml, /Checkout \(Authoritative BRL Quote\)/);
      assert.match(checkoutHtml, /R\$\s?54\.57/);

      // 7. Route /orders/[orderId] (Order #10001 live tracking + OTP notice)
      const orderRes = await fetch(
        `${webBaseUrl}/orders/00000000-0000-4000-8000-000000001001?locale=en`
      );
      assert.equal(orderRes.status, 200);
      const orderHtml = await orderRes.text();
      assert.match(orderHtml, /Order #10001 — Live Tracking/);
      assert.match(orderHtml, /4-digit delivery confirmation code/);
      assert.match(orderHtml, /ORDER_CREATED/);

      // 8. Route /orders/[orderId]/review (Verified review & support ticket from live Supabase)
      const reviewRes = await fetch(
        `${webBaseUrl}/orders/00000000-0000-4000-8000-000000001001/review?locale=en`
      );
      assert.equal(reviewRes.status, 200);
      const reviewHtml = await reviewRes.text();
      assert.match(reviewHtml, /Crisp smash burger crust and fast delivery!/);
      assert.match(reviewHtml, /Thank you for ordering with Paulista Artisan Burgers!/);
      assert.match(reviewHtml, /#5001 — Added intercom note for concierge/);

      // 9. Route /profile (Alice's profile, WEB device, and LGPD privacy section)
      const profileRes = await fetch(`${webBaseUrl}/profile?locale=pt-BR`);
      assert.equal(profileRes.status, 200);
      const profileHtml = await profileRes.text();
      assert.match(profileHtml, /Alice Test Consumer/);
      assert.match(profileHtml, /seed-web-pwa-alice-001/);
      assert.match(profileHtml, /Direitos do Titular LGPD/);
    });
  });
});
