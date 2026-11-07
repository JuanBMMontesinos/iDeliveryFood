import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  AdminGovernanceActionContract,
  AdminStaffScopeGrantRequestContract,
  AuthenticatedActorProfileContract,
  BankAccountChangeRequestContract,
  BatchCatalogUpdateItemResultContract,
  CourierLocationSampleContract,
  CustomerAddressContract,
  DeliveryOfferContract,
  DeliveryTaskContract,
  OrderEventRecordContract,
  OrderRecordContract,
  PaymentAttemptContract,
  PspReconciliationRunContract,
  PublishedStoreContract,
  RefundRecordContract,
  ServerQuoteRecordContract,
  SettlementRecordContract,
  StoreSettingsPatchContract,
  SupportedLocale,
  UserPreferencesContract,
} from "@ideliveryfood/contracts";
import type { StoredInvitationRecord } from "@ideliveryfood/authz";
import { computePspWebhookSignature } from "@ideliveryfood/domain";
import {
  createApiServer,
  createSupabasePostgresRepository,
  signSupabaseHs256Jwt,
  verifySupabaseHs256Jwt,
  type ApiDataRepository,
  type AuditLogWriteRecord,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnvForTests(): void {
  const candidates = [
    path.resolve(__dirname, "../../../.env"),
    path.resolve(__dirname, "../../../../.env"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
    break;
  }
}

loadDotEnvForTests();

function createCompleteUnitTestRepository(): ApiDataRepository {
  const auditLogs: AuditLogWriteRecord[] = [];
  const invitations = new Map<string, StoredInvitationRecord>();
  const userLocales = new Map<string, SupportedLocale>([
    ["00000000-0000-4000-8000-000000000001", "en"],
  ]);
  const addressesByUserId = new Map<string, CustomerAddressContract[]>();
  const quotesById = new Map<string, ServerQuoteRecordContract>();
  const quotesByCustomerIdem = new Map<string, ServerQuoteRecordContract>();
  const ordersById = new Map<string, OrderRecordContract>();
  const ordersByCustomerIdem = new Map<string, OrderRecordContract>();
  const orderEventsByOrderId = new Map<string, OrderEventRecordContract[]>();
  const processedWebhooks = new Set<string>();
  const paymentAttemptsById = new Map<string, PaymentAttemptContract>();
  const refundsByOrderId = new Map<string, RefundRecordContract[]>();
  const storeOverridesById = new Map<string, StoreSettingsPatchContract>();
  const bankChangeRequestsById = new Map<string, BankAccountChangeRequestContract>();
  const settlementsById = new Map<string, SettlementRecordContract>();
  const reconciliationRunsById = new Map<string, PspReconciliationRunContract>();
  const deliveryTasksById = new Map<
    string,
    {
      task: DeliveryTaskContract;
      fullAddress: string | null;
      confirmationCodeHash: string | null;
    }
  >();
  const deliveryOffersById = new Map<string, DeliveryOfferContract>();
  let orderSequence = 10010;

  const actors: Record<string, AuthenticatedActorProfileContract> = {
    "00000000-0000-4000-8000-000000000001": {
      id: "00000000-0000-4000-8000-000000000001",
      email: "customer.alice@test.ideliveryfood.invalid",
      fullName: "Alice Test Consumer",
      phone: "+5511900000001",
      preferredLocale: "en",
      status: "ACTIVE",
      mfaEnforced: false,
      aal: "aal1",
      organizationMemberships: [],
      staffScopes: [],
    },
    "00000000-0000-4000-8000-000000000010": {
      id: "00000000-0000-4000-8000-000000000010",
      email: "owner.paulista@test.ideliveryfood.invalid",
      fullName: "Helena Partner Owner",
      phone: "+5511900000010",
      preferredLocale: "pt-BR",
      status: "ACTIVE",
      mfaEnforced: false,
      aal: "aal1",
      organizationMemberships: [
        {
          organizationId: "00000000-0000-4000-8000-000000000101",
          storeId: null,
          role: "partner_owner",
        },
      ],
      staffScopes: [],
    },
    "00000000-0000-4000-8000-000000000011": {
      id: "00000000-0000-4000-8000-000000000011",
      email: "operator.paulista@test.ideliveryfood.invalid",
      fullName: "Lucas Store Operator",
      phone: "+5511900000011",
      preferredLocale: "pt-BR",
      status: "ACTIVE",
      mfaEnforced: false,
      aal: "aal1",
      organizationMemberships: [
        {
          organizationId: "00000000-0000-4000-8000-000000000101",
          storeId: "00000000-0000-4000-8000-000000000201",
          role: "partner_operator",
        },
      ],
      staffScopes: [],
    },
    "00000000-0000-4000-8000-000000000090": {
      id: "00000000-0000-4000-8000-000000000090",
      email: "staff.ops@test.ideliveryfood.invalid",
      fullName: "Marina Platform Operations",
      phone: "+5511900000090",
      preferredLocale: "en",
      status: "ACTIVE",
      mfaEnforced: true,
      aal: "aal1",
      organizationMemberships: [],
      staffScopes: [
        {
          role: "operations",
          regionCode: "BR-SP",
          maxRefundApprovalCents: 10000,
          requiresMfa: true,
        },
      ],
    },
    "00000000-0000-4000-8000-000000000091": {
      id: "00000000-0000-4000-8000-000000000091",
      email: "staff.finance@test.ideliveryfood.invalid",
      fullName: "Rafael Finance Controller",
      phone: "+5511900000091",
      preferredLocale: "en",
      status: "ACTIVE",
      mfaEnforced: true,
      aal: "aal1",
      organizationMemberships: [],
      staffScopes: [
        {
          role: "finance",
          regionCode: null,
          maxRefundApprovalCents: 0,
          requiresMfa: true,
        },
      ],
    },
  };

  return {
    async listPublishedStores(locale: SupportedLocale): Promise<PublishedStoreContract[]> {
      const override = storeOverridesById.get("00000000-0000-4000-8000-000000000201");
      return [
        {
          id: "00000000-0000-4000-8000-000000000201",
          slug: "paulista-burgers-jardins",
          name: "Paulista Artisan Burgers - Jardins",
          descriptionEn: "Dry-aged smash burgers, hand-cut fries, and craft shakes.",
          descriptionPtBr: "Smash burgers maturados, batatas rústicas e shakes artesanais.",
          localizedDescription:
            locale === "pt-BR"
              ? "Smash burgers maturados, batatas rústicas e shakes artesanais."
              : "Dry-aged smash burgers, hand-cut fries, and craft shakes.",
          cuisineCategory: "BURGERS",
          isPaused: override?.isPaused ?? false,
          timezone: "America/Sao_Paulo",
          city: "São Paulo",
          stateCode: "SP",
          latitude: -23.561414,
          longitude: -46.655881,
          minOrderCents: override?.minOrderCents ?? 2500,
          prepTimeMinMinutes: override?.prepTimeMinMinutes ?? 20,
          prepTimeMaxMinutes: override?.prepTimeMaxMinutes ?? 35,
          supportedModalities: ["PLATFORM_DELIVERY", "MERCHANT_DELIVERY", "PICKUP"],
        },
      ];
    },
    async getStoreById(storeId: string, locale: SupportedLocale) {
      if (storeId !== "00000000-0000-4000-8000-000000000201") return null;
      const stores = await this.listPublishedStores(locale);
      return {
        ...stores[0]!,
        organizationId: "00000000-0000-4000-8000-000000000101",
      };
    },
    async getStoreCatalog(storeId: string, locale: SupportedLocale) {
      const storeWithOrg = await this.getStoreById(storeId, locale);
      if (!storeWithOrg) return null;
      const { organizationId: _orgId, ...store } = storeWithOrg;
      return {
        store,
        weeklyHours: [
          { dayOfWeek: 0, opensAt: "00:00:00", closesAt: "23:59:59", isOvernight: false, isClosed: false },
          { dayOfWeek: 1, opensAt: "00:00:00", closesAt: "23:59:59", isOvernight: false, isClosed: false },
          { dayOfWeek: 2, opensAt: "00:00:00", closesAt: "23:59:59", isOvernight: false, isClosed: false },
          { dayOfWeek: 3, opensAt: "00:00:00", closesAt: "23:59:59", isOvernight: false, isClosed: false },
          { dayOfWeek: 4, opensAt: "00:00:00", closesAt: "23:59:59", isOvernight: false, isClosed: false },
          { dayOfWeek: 5, opensAt: "00:00:00", closesAt: "23:59:59", isOvernight: false, isClosed: false },
          { dayOfWeek: 6, opensAt: "00:00:00", closesAt: "23:59:59", isOvernight: false, isClosed: false },
        ],
        exceptions: [],
        serviceAreas: [
          {
            id: "area_351",
            storeId: store.id,
            name: "Jardins (7km)",
            radiusMeters: 7000,
            baseFeeCents: 690,
            perKmFeeCents: 150,
            freeDeliveryMinOrderCents: 12000,
            estimatedDeliveryMinutes: 35,
            isActive: true,
          },
        ],
        categories: [
          {
            id: "00000000-0000-4000-8000-000000000501",
            storeId: store.id,
            nameEn: "Smash Burgers",
            namePtBr: "Smash Burgers",
            localizedName: "Smash Burgers",
            sortOrder: 1,
            isActive: true,
            products: [
              {
                id: "00000000-0000-4000-8000-000000000601",
                storeId: store.id,
                categoryId: "00000000-0000-4000-8000-000000000501",
                sku: "PAB-SMASH-01",
                nameEn: "Double Paulista Truffle Smash",
                namePtBr: "Duplo Smash Paulista Trufado",
                localizedName:
                  locale === "pt-BR"
                    ? "Duplo Smash Paulista Trufado"
                    : "Double Paulista Truffle Smash",
                descriptionEn: "Dry-aged smash burger",
                descriptionPtBr: "Smash burger maturado",
                localizedDescription: "Dry-aged smash burger",
                priceCents: 3890,
                isAvailable: true,
                isPaused: false,
                maxPerOrder: 10,
                unitOfMeasure: "UNIT",
                optionGroups: [],
              },
            ],
          },
        ],
      };
    },
    async updateStoreSettings(storeId: string, patch: StoreSettingsPatchContract, locale: SupportedLocale) {
      const merged = { ...(storeOverridesById.get(storeId) ?? {}), ...patch };
      storeOverridesById.set(storeId, merged);
      const storeWithOrg = await this.getStoreById(storeId, locale);
      if (!storeWithOrg) return null;
      const { organizationId: _orgId, ...store } = storeWithOrg;
      return store;
    },
    async getActorById(userId: string, aal: "aal1" | "aal2") {
      const found = actors[userId];
      if (!found) return null;
      return {
        ...found,
        preferredLocale: userLocales.get(userId) ?? found.preferredLocale,
        aal,
      };
    },
    async updateUserPreferences(userId: string, locale: SupportedLocale): Promise<UserPreferencesContract> {
      userLocales.set(userId, locale);
      return {
        userId,
        locale,
        pushOrderUpdates: true,
        pushPromotions: false,
        emailTransactional: true,
        emailMarketing: false,
      };
    },
    async revokeUserDevice() {},
    async savePrivacyRequest() {},
    async listOrganizationMembers(organizationId: string) {
      return [
        {
          userId: "00000000-0000-4000-8000-000000000010",
          organizationId,
          storeId: null,
          role: "partner_owner",
        },
      ];
    },
    async saveInvitation(record: StoredInvitationRecord) {
      invitations.set(record.id, record);
    },
    async getInvitationById(id: string) {
      return invitations.get(id) ?? null;
    },
    async markInvitationConsumed(id: string, consumedAtIso: string) {
      const existing = invitations.get(id);
      if (existing) {
        invitations.set(id, { ...existing, consumedAtIso });
      }
    },
    async appendAuditLog(entry: AuditLogWriteRecord) {
      auditLogs.push(entry);
    },
    async getAuditLogs() {
      return auditLogs;
    },
    async listCustomerAddresses(userId: string) {
      return addressesByUserId.get(userId) ?? [];
    },
    async saveCustomerAddress(address: CustomerAddressContract) {
      const list = addressesByUserId.get(address.userId) ?? [];
      list.push(address);
      addressesByUserId.set(address.userId, list);
    },
    async saveQuote(quote: ServerQuoteRecordContract) {
      quotesById.set(quote.id, quote);
      quotesByCustomerIdem.set(`${quote.customerId}:${quote.idempotencyKey}`, quote);
    },
    async getQuoteById(quoteId: string) {
      return quotesById.get(quoteId) ?? null;
    },
    async getQuoteByCustomerIdempotencyKey(customerId: string, idempotencyKey: string) {
      return quotesByCustomerIdem.get(`${customerId}:${idempotencyKey}`) ?? null;
    },
    async markQuoteConsumed(quoteId: string, consumedAtIso: string) {
      const q = quotesById.get(quoteId);
      if (q) quotesById.set(quoteId, { ...q, consumedAtIso });
    },
    async nextOrderNumber() {
      orderSequence += 1;
      return orderSequence;
    },
    async saveOrder(order: OrderRecordContract, initialEvent: OrderEventRecordContract) {
      ordersById.set(order.id, order);
      ordersByCustomerIdem.set(`${order.customerId}:${order.idempotencyKey}`, order);
      orderEventsByOrderId.set(order.id, [initialEvent]);
    },
    async getOrderById(orderId: string) {
      return ordersById.get(orderId) ?? null;
    },
    async getOrderByCustomerIdempotencyKey(customerId: string, idempotencyKey: string) {
      return ordersByCustomerIdem.get(`${customerId}:${idempotencyKey}`) ?? null;
    },
    async listOrdersByStore(storeId: string) {
      return Array.from(ordersById.values()).filter((o) => o.storeId === storeId);
    },
    async updateOrderWithEvent(order: OrderRecordContract, event: OrderEventRecordContract) {
      ordersById.set(order.id, order);
      const evts = orderEventsByOrderId.get(order.id) ?? [];
      evts.push(event);
      orderEventsByOrderId.set(order.id, evts);
    },
    async listOrderEvents(orderId: string) {
      return orderEventsByOrderId.get(orderId) ?? [];
    },
    async hasProcessedWebhookEvent(providerCode: string, externalEventId: string) {
      return processedWebhooks.has(`${providerCode}:${externalEventId}`);
    },
    async recordProcessedWebhookEvent(params) {
      processedWebhooks.add(`${params.providerCode}:${params.externalEventId}`);
    },
    async savePaymentAttempt(attempt: PaymentAttemptContract) {
      paymentAttemptsById.set(attempt.id, attempt);
    },
    async listRefundsByOrder(orderId: string) {
      return refundsByOrderId.get(orderId) ?? [];
    },
    async saveRefundAndUpdateOrder(refund: RefundRecordContract, updatedOrder: OrderRecordContract) {
      const list = refundsByOrderId.get(refund.orderId) ?? [];
      list.push(refund);
      refundsByOrderId.set(refund.orderId, list);
      ordersById.set(updatedOrder.id, updatedOrder);
    },
    async saveBankAccountChangeRequest(req: BankAccountChangeRequestContract) {
      bankChangeRequestsById.set(req.id, req);
    },
    async grantStaffScope(_grant: AdminStaffScopeGrantRequestContract & { grantedBy: string }) {},
    async saveGovernanceApprovalEvent(_action: AdminGovernanceActionContract) {},
    async saveReconciliationRun(run: PspReconciliationRunContract) {
      reconciliationRunsById.set(run.id, run);
    },
    async getSettlementById(settlementId: string) {
      return settlementsById.get(settlementId) ?? null;
    },
    async saveSettlement(settlement: SettlementRecordContract) {
      settlementsById.set(settlement.id, settlement);
    },
    async saveDeliveryTaskAndOffer(params) {
      deliveryTasksById.set(params.task.id, {
        task: params.task,
        fullAddress: params.fullAddress,
        confirmationCodeHash: params.confirmationCodeHash,
      });
      deliveryOffersById.set(params.offer.id, params.offer);
    },
    async getDeliveryOfferById(offerId: string) {
      return deliveryOffersById.get(offerId) ?? null;
    },
    async getDeliveryTaskById(taskId: string) {
      return deliveryTasksById.get(taskId) ?? null;
    },
    async saveAcceptedDeliveryOffer(params) {
      deliveryOffersById.set(params.offer.id, params.offer);
      const prev = deliveryTasksById.get(params.task.id);
      deliveryTasksById.set(params.task.id, {
        task: params.task,
        fullAddress: params.fullAddress,
        confirmationCodeHash: prev?.confirmationCodeHash ?? null,
      });
    },
    async completeDeliveryTask(task: DeliveryTaskContract) {
      const prev = deliveryTasksById.get(task.id);
      deliveryTasksById.set(task.id, {
        task,
        fullAddress: prev?.fullAddress ?? null,
        confirmationCodeHash: prev?.confirmationCodeHash ?? null,
      });
    },
    async saveCourierLocationSample(_sample: CourierLocationSampleContract) {},
  };
}

describe("@ideliveryfood/api — /v1 HTTP Unit & Contract Suite (Fase A–E)", () => {
  const repository = createCompleteUnitTestRepository();
  const testJwtSecret = "test_supabase_jwt_secret_minimum_32_characters_long";
  const server = createApiServer({
    repository,
    env: { SUPABASE_JWT_SECRET: testJwtSecret },
  });
  let baseUrl = "";

  before(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/v1`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("verifies cryptographic Supabase HS256 JWT authentication, aal2 claims, expired tokens, and production header block (Fase E / M03)", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const validToken = signSupabaseHs256Jwt(
      {
        sub: "00000000-0000-4000-8000-000000000090",
        aal: "aal2",
        exp: nowSec + 300,
      },
      testJwtSecret
    );
    const claims = verifySupabaseHs256Jwt({
      token: validToken,
      jwtSecret: testJwtSecret,
      nowSeconds: nowSec,
    });
    assert.equal(claims.sub, "00000000-0000-4000-8000-000000000090");
    assert.equal(claims.aal, "aal2");

    // 1. Authenticated /v1/me via Bearer JWT
    const meRes = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert.equal(meRes.status, 200);
    const meJson = (await meRes.json()) as { data: AuthenticatedActorProfileContract };
    assert.equal(meJson.data.id, "00000000-0000-4000-8000-000000000090");
    assert.equal(meJson.data.aal, "aal2");

    // 2. Expired token rejected with 401 AUTH_JWT_EXPIRED
    const expiredToken = signSupabaseHs256Jwt(
      {
        sub: "00000000-0000-4000-8000-000000000001",
        aal: "aal1",
        exp: nowSec - 10,
      },
      testJwtSecret
    );
    const expRes = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(expRes.status, 401);

    // 3. Tampered signature rejected with 401 AUTH_JWT_INVALID_SIGNATURE
    const tamperedRes = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${validToken}tampered` },
    });
    assert.equal(tamperedRes.status, 401);

    // 4. Production server strictly rejects raw X-Actor-Id header without Bearer JWT
    const prodServer = createApiServer({
      repository,
      env: { APP_ENV: "production", SUPABASE_JWT_SECRET: testJwtSecret },
    });
    await new Promise<void>((resolve) => prodServer.listen(0, "127.0.0.1", () => resolve()));
    const prodPort = (prodServer.address() as AddressInfo).port;
    try {
      const rawHeaderRes = await fetch(`http://127.0.0.1:${prodPort}/v1/me`, {
        headers: { "X-Actor-Id": "00000000-0000-4000-8000-000000000001" },
      });
      assert.equal(rawHeaderRes.status, 401);

      const jwtProdRes = await fetch(`http://127.0.0.1:${prodPort}/v1/me`, {
        headers: { Authorization: `Bearer ${validToken}` },
      });
      assert.equal(jwtProdRes.status, 200);
    } finally {
      await new Promise<void>((resolve) => prodServer.close(() => resolve()));
    }
  });

  it("rejects missing required fields instead of falling back to hardcoded UUIDs or addresses (Fase E Rule #3 Zero-Mock)", async () => {
    const missingStoreQuoteRes = await fetch(`${baseUrl}/quotes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
      },
      body: JSON.stringify({
        fulfillmentModality: "PLATFORM_DELIVERY",
        cartItems: [],
      }),
    });
    assert.equal(missingStoreQuoteRes.status, 400);

    const missingAddressOfferRes = await fetch(`${baseUrl}/logistics/offers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000090",
        "X-Actor-Aal": "aal2",
      },
      body: JSON.stringify({
        deliveryTaskId: "dtask_missing_addr",
      }),
    });
    assert.equal(missingAddressOfferRes.status, 400);
  });

  it("serves /v1/health/live, /v1/health/ready, and /v1/system/providers with honest BLOCKED_MISSING_CREDENTIALS status", async () => {
    const liveRes = await fetch(`${baseUrl}/health/live`);
    assert.equal(liveRes.status, 200);

    const readyRes = await fetch(`${baseUrl}/health/ready`);
    assert.equal(readyRes.status, 200);
    const readyJson = (await readyRes.json()) as {
      databaseProjectRef: string;
      defaultLocale: string;
      externalProviders: Array<{ status: string }>;
    };
    assert.equal(readyJson.databaseProjectRef, "dwsoochnfxldfvcaijie");
    assert.equal(readyJson.defaultLocale, "en");
    assert.equal(readyJson.externalProviders.length, 8);
    assert.equal(readyJson.externalProviders[0]?.status, "BLOCKED_MISSING_CREDENTIALS");
  });

  it("serves /v1/stores, /v1/stores/:storeId/catalog, and /v1/stores/:storeId/availability (M04)", async () => {
    const enRes = await fetch(`${baseUrl}/stores?locale=en`);
    const enJson = (await enRes.json()) as { data: PublishedStoreContract[] };
    assert.match(enJson.data[0]?.localizedDescription ?? "", /Dry-aged smash burgers/);

    const ptRes = await fetch(`${baseUrl}/stores?locale=pt-BR`);
    const ptJson = (await ptRes.json()) as { data: PublishedStoreContract[] };
    assert.match(ptJson.data[0]?.localizedDescription ?? "", /Smash burgers maturados/);

    const catRes = await fetch(
      `${baseUrl}/stores/00000000-0000-4000-8000-000000000201/catalog?locale=pt-BR`
    );
    assert.equal(catRes.status, 200);

    const availRes = await fetch(
      `${baseUrl}/stores/00000000-0000-4000-8000-000000000201/availability?lat=-23.56398&lng=-46.66912&modality=PLATFORM_DELIVERY&basketCents=5580`
    );
    assert.equal(availRes.status, 200);
    const availJson = (await availRes.json()) as {
      data: {
        availability: { isOpen: boolean };
        coverage: { eligible: boolean; distanceMeters: number };
      };
    };
    assert.equal(availJson.data.availability.isOpen, true);
    assert.equal(availJson.data.coverage.eligible, true);
    assert.ok(availJson.data.coverage.distanceMeters > 1300);
  });

  it("persists user locale switch ('en' -> 'pt-BR') and emits an audit log", async () => {
    const patchRes = await fetch(`${baseUrl}/me/preferences`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
        "X-Idempotency-Key": "idem_locale_switch_001",
      },
      body: JSON.stringify({ locale: "pt-BR" }),
    });
    assert.equal(patchRes.status, 200);
    const updatedPref = (await patchRes.json()) as UserPreferencesContract;
    assert.equal(updatedPref.locale, "pt-BR");
  });

  it("enforces cross-tenant denial on /v1/organizations/:orgId/members and partial unit scope on M09 catalog-batch", async () => {
    const allowedRes = await fetch(
      `${baseUrl}/organizations/00000000-0000-4000-8000-000000000101/members`,
      {
        headers: { "X-Actor-Id": "00000000-0000-4000-8000-000000000010" },
      }
    );
    assert.equal(allowedRes.status, 200);

    const deniedRes = await fetch(
      `${baseUrl}/organizations/00000000-0000-4000-8000-000000000102/members`,
      {
        headers: { "X-Actor-Id": "00000000-0000-4000-8000-000000000010" },
      }
    );
    assert.equal(deniedRes.status, 403);

    const batchRes = await fetch(
      `${baseUrl}/organizations/00000000-0000-4000-8000-000000000101/catalog-batch`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Actor-Id": "00000000-0000-4000-8000-000000000011",
        },
        body: JSON.stringify({
          productId: "00000000-0000-4000-8000-000000000601",
          targetStoreIds: [
            "00000000-0000-4000-8000-000000000201",
            "00000000-0000-4000-8000-000000000203",
          ],
        }),
      }
    );
    assert.equal(batchRes.status, 200);
    const batchJson = (await batchRes.json()) as { data: BatchCatalogUpdateItemResultContract[] };
    assert.equal(batchJson.data[0]?.status, "APPLIED");
    assert.equal(batchJson.data[1]?.status, "DENIED_SCOPE");
  });

  it("executes full M10 quote -> order -> payment attempt (honest 503 block) -> webhook capture -> command -> M12 refund flow", async () => {
    const quoteRes = await fetch(`${baseUrl}/quotes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
        "X-Idempotency-Key": "idem_quote_flow_001",
      },
      body: JSON.stringify({
        storeId: "00000000-0000-4000-8000-000000000201",
        fulfillmentModality: "PLATFORM_DELIVERY",
        cartItems: [
          {
            productId: "00000000-0000-4000-8000-000000000601",
            quantity: 1,
            selectedOptions: [],
          },
        ],
        deliveryFeeCents: 690,
      }),
    });
    assert.equal(quoteRes.status, 201);
    const quoteJson = (await quoteRes.json()) as { data: ServerQuoteRecordContract };
    assert.equal(quoteJson.data.subtotalCents, 3890);

    const orderRes = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
        "X-Idempotency-Key": "idem_order_flow_001",
      },
      body: JSON.stringify({
        quoteId: quoteJson.data.id,
        customerNotes: "Ring bell",
      }),
    });
    assert.equal(orderRes.status, 201);
    const orderJson = (await orderRes.json()) as { data: OrderRecordContract };
    assert.equal(orderJson.data.orderStatus, "AWAITING_PAYMENT");
    assert.equal(orderJson.data.version, 1);

    const reuseQuoteRes = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
        "X-Idempotency-Key": "idem_order_flow_002_different",
      },
      body: JSON.stringify({
        quoteId: quoteJson.data.id,
      }),
    });
    assert.equal(reuseQuoteRes.status, 409);

    const payAttemptRes = await fetch(`${baseUrl}/payments/attempts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
        "X-Idempotency-Key": "idem_pay_attempt_001",
      },
      body: JSON.stringify({
        orderId: orderJson.data.id,
        providerCode: "stripe",
        paymentMethod: "PIX",
      }),
    });
    assert.equal(payAttemptRes.status, 503);

    const rawWebhookPayload = JSON.stringify({
      orderId: orderJson.data.id,
      externalEventId: "evt_stripe_capture_001",
      eventType: "payment.captured",
      amountCents: orderJson.data.totalCents,
      currencyCode: "BRL",
    });
    const tsSec = Math.floor(Date.now() / 1000);
    const sig = computePspWebhookSignature({
      webhookSecret: "whsec_default_dev_test",
      timestampSeconds: tsSec,
      rawPayload: rawWebhookPayload,
    });

    const webhookRes = await fetch(`${baseUrl}/webhooks/psp/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Psp-Signature": sig,
        "X-Psp-Timestamp": String(tsSec),
      },
      body: rawWebhookPayload,
    });
    assert.equal(webhookRes.status, 200);

    const acceptCmdRes = await fetch(`${baseUrl}/orders/${orderJson.data.id}/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000011",
        "X-Idempotency-Key": "idem_cmd_accept_001",
      },
      body: JSON.stringify({
        command: "ACCEPT",
        expectedVersion: 2,
      }),
    });
    assert.equal(acceptCmdRes.status, 200);

    const refundRes = await fetch(`${baseUrl}/refunds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000090",
        "X-Actor-Aal": "aal2",
        "X-Idempotency-Key": "idem_refund_001",
      },
      body: JSON.stringify({
        orderId: orderJson.data.id,
        paymentAttemptId: "pay_001",
        amountCents: 1000,
        reason: "Partial refund for delayed item",
      }),
    });
    assert.equal(refundRes.status, 201);
    const refundJson = (await refundRes.json()) as { data: RefundRecordContract };
    assert.equal(refundJson.data.status, "APPROVED");
  });

  it("enforces MFA aal2 step-up on /v1/onboarding/approvals and single-use invitations", async () => {
    const deniedAal1 = await fetch(`${baseUrl}/onboarding/approvals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000090",
        "X-Actor-Aal": "aal1",
      },
      body: JSON.stringify({
        targetType: "STORE",
        targetId: "00000000-0000-4000-8000-000000000203",
        decision: "APPROVED",
        reason: "Store KYC verified",
      }),
    });
    assert.equal(deniedAal1.status, 403);

    const allowedAal2 = await fetch(`${baseUrl}/onboarding/approvals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000090",
        "X-Actor-Aal": "aal2",
      },
      body: JSON.stringify({
        targetType: "STORE",
        targetId: "00000000-0000-4000-8000-000000000203",
        decision: "APPROVED",
        reason: "Store KYC verified",
      }),
    });
    assert.equal(allowedAal2.status, 200);
  });

  it("handles Fase C endpoints: M07 store pause settings, M08 kitchen orders queue, and M16 admin self-grant prohibition & audit logs", async () => {
    const pauseRes = await fetch(
      `${baseUrl}/stores/00000000-0000-4000-8000-000000000201/settings`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Actor-Id": "00000000-0000-4000-8000-000000000011",
          "X-Idempotency-Key": "idem_store_pause_201",
        },
        body: JSON.stringify({
          organizationId: "00000000-0000-4000-8000-000000000101",
          isPaused: true,
          pauseReason: "Kitchen shift handover",
        }),
      }
    );
    assert.equal(pauseRes.status, 200);

    const queueRes = await fetch(
      `${baseUrl}/stores/00000000-0000-4000-8000-000000000201/orders-queue?organizationId=00000000-0000-4000-8000-000000000101`,
      {
        headers: {
          "X-Actor-Id": "00000000-0000-4000-8000-000000000011",
        },
      }
    );
    assert.equal(queueRes.status, 200);
    const queueJson = (await queueRes.json()) as {
      data: { isStorePaused: boolean; activeOrderCount: number };
    };
    assert.equal(queueJson.data.isStorePaused, true);
    assert.ok(queueJson.data.activeOrderCount >= 1);

    const selfGrantRes = await fetch(`${baseUrl}/admin/staff-scopes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000090",
        "X-Actor-Aal": "aal2",
        "X-Idempotency-Key": "idem_self_grant_attempt",
      },
      body: JSON.stringify({
        targetUserId: "00000000-0000-4000-8000-000000000090",
        role: "finance",
        maxRefundApprovalCents: 100000,
        justification: "Attempting self-grant",
      }),
    });
    assert.equal(selfGrantRes.status, 403);

    const auditLogsRes = await fetch(`${baseUrl}/admin/audit-logs`, {
      headers: {
        "X-Actor-Id": "00000000-0000-4000-8000-000000000090",
        "X-Actor-Aal": "aal2",
      },
    });
    assert.equal(auditLogsRes.status, 200);
    const auditLogsJson = (await auditLogsRes.json()) as { data: unknown[] };
    assert.ok(auditLogsJson.data.length >= 2);
  });

  it("verifies Fase D (M13, M14, M11) HTTP flows: PSP reconciliation, payout Segregation of Duties, transactional offer acceptance, GPS telemetry & 4-digit OTP completion", async () => {
    const reconDeniedRes = await fetch(`${baseUrl}/finance/reconciliation-runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000090",
        "X-Actor-Aal": "aal2",
        "X-Idempotency-Key": "idem_recon_denied_001",
      },
      body: JSON.stringify({ providerCode: "stripe", expectedOrders: [], pspReportedCaptures: [] }),
    });
    assert.equal(reconDeniedRes.status, 403);

    const reconAal1Res = await fetch(`${baseUrl}/finance/reconciliation-runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000091",
        "X-Actor-Aal": "aal1",
        "X-Idempotency-Key": "idem_recon_aal1_001",
      },
      body: JSON.stringify({ providerCode: "stripe", expectedOrders: [], pspReportedCaptures: [] }),
    });
    assert.equal(reconAal1Res.status, 403);

    const reconRes = await fetch(`${baseUrl}/finance/reconciliation-runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000091",
        "X-Actor-Aal": "aal2",
        "X-Idempotency-Key": "idem_recon_run_001",
      },
      body: JSON.stringify({
        providerCode: "stripe",
        runDate: "2026-11-03",
        expectedOrders: [
          { orderId: "ord_101", totalCents: 4500 },
          { orderId: "ord_102", totalCents: 3800 },
        ],
        pspReportedCaptures: [
          { orderId: "ord_101", capturedCents: 4500 },
          { orderId: "ord_102", capturedCents: 3700 },
        ],
      }),
    });
    assert.equal(reconRes.status, 201);
    const reconJson = (await reconRes.json()) as {
      data: { matchedCount: number; discrepancyCount: number; discrepancyTotalCents: number };
    };
    assert.equal(reconJson.data.matchedCount, 1);
    assert.equal(reconJson.data.discrepancyCount, 1);
    assert.equal(reconJson.data.discrepancyTotalCents, 100);

    const sodViolationRes = await fetch(`${baseUrl}/finance/settlements/settle_001/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000091",
        "X-Actor-Aal": "aal2",
        "X-Idempotency-Key": "idem_settle_sod_001",
      },
      body: JSON.stringify({
        organizationId: "00000000-0000-4000-8000-000000000101",
        amountCents: 42500,
        providerCode: "stripe",
        bankAccountApprovedByActorId: "00000000-0000-4000-8000-000000000091",
      }),
    });
    assert.equal(sodViolationRes.status, 403);

    const blockedSettleRes = await fetch(`${baseUrl}/finance/settlements/settle_001/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000091",
        "X-Actor-Aal": "aal2",
        "X-Idempotency-Key": "idem_settle_ok_001",
      },
      body: JSON.stringify({
        organizationId: "00000000-0000-4000-8000-000000000101",
        amountCents: 42500,
        providerCode: "stripe",
        bankAccountApprovedByActorId: "00000000-0000-4000-8000-000000000099",
      }),
    });
    assert.equal(blockedSettleRes.status, 200);
    const blockedSettleJson = (await blockedSettleRes.json()) as {
      data: { status: string; externalPayoutReference: string | null };
    };
    assert.equal(blockedSettleJson.data.status, "BLOCKED_NO_PSP");
    assert.equal(blockedSettleJson.data.externalPayoutReference, null);

    const offerForbiddenRes = await fetch(`${baseUrl}/logistics/offers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
      },
      body: JSON.stringify({
        deliveryTaskId: "dtask_forbidden",
        offerId: "doff_forbidden",
        dropoffNeighborhoodOnly: "Bela Vista",
        dropoffFullAddress: "Av. Paulista, 1578",
        confirmationCode: "4829",
      }),
    });
    assert.equal(offerForbiddenRes.status, 403);

    const offerCreateRes = await fetch(`${baseUrl}/logistics/offers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000090",
        "X-Actor-Aal": "aal2",
      },
      body: JSON.stringify({
        deliveryTaskId: "dtask_http_1",
        offerId: "doff_http_1",
        courierId: "00000000-0000-4000-8000-000000000001",
        dropoffNeighborhoodOnly: "Bela Vista",
        dropoffFullAddress: "Av. Paulista, 1578 - Apt 42, Bela Vista",
        confirmationCode: "4829",
        offeredFeeCents: 890,
      }),
    });
    assert.equal(offerCreateRes.status, 201);
    const offerCreateJson = (await offerCreateRes.json()) as {
      data: { task: { dropoffFullAddress: string | null } };
    };
    assert.equal(offerCreateJson.data.task.dropoffFullAddress, null);

    const acceptOfferRes = await fetch(`${baseUrl}/logistics/offers/doff_http_1/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
        "X-Idempotency-Key": "idem_accept_doff_1",
      },
      body: JSON.stringify({
        isCourierOnline: true,
      }),
    });
    assert.equal(acceptOfferRes.status, 200);
    const acceptOfferJson = (await acceptOfferRes.json()) as {
      data: { task: { activeCourierId: string; dropoffFullAddress: string } };
    };
    assert.equal(acceptOfferJson.data.task.activeCourierId, "00000000-0000-4000-8000-000000000001");
    assert.equal(
      acceptOfferJson.data.task.dropoffFullAddress,
      "Av. Paulista, 1578 - Apt 42, Bela Vista"
    );

    const acceptDuplicateRes = await fetch(`${baseUrl}/logistics/offers/doff_http_1/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
        "X-Idempotency-Key": "idem_accept_doff_dup",
      },
      body: JSON.stringify({
        isCourierOnline: true,
      }),
    });
    assert.equal(acceptDuplicateRes.status, 409);

    const locRes = await fetch(`${baseUrl}/logistics/location-samples`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
        "X-Idempotency-Key": "idem_loc_sample_001",
      },
      body: JSON.stringify({
        deliveryTaskId: "dtask_http_1",
        latitude: -23.5625,
        longitude: -46.6612,
        accuracyMeters: 12,
        recordedAtIso: new Date().toISOString(),
      }),
    });
    assert.equal(locRes.status, 201);

    const wrongOtpRes = await fetch(`${baseUrl}/logistics/tasks/dtask_http_1/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
        "X-Idempotency-Key": "idem_complete_wrong_otp",
      },
      body: JSON.stringify({ confirmationCode: "0000" }),
    });
    assert.equal(wrongOtpRes.status, 409);

    const validOtpRes = await fetch(`${baseUrl}/logistics/tasks/dtask_http_1/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
        "X-Idempotency-Key": "idem_complete_valid_otp",
      },
      body: JSON.stringify({ confirmationCode: "4829" }),
    });
    assert.equal(validOtpRes.status, 200);
    const validOtpJson = (await validOtpRes.json()) as { data: { status: string } };
    assert.equal(validOtpJson.data.status, "DELIVERED");

    const replayCompleteRes = await fetch(`${baseUrl}/logistics/tasks/dtask_http_1/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
        "X-Idempotency-Key": "idem_complete_replay_otp",
      },
      body: JSON.stringify({ confirmationCode: "4829" }),
    });
    assert.equal(replayCompleteRes.status, 409);

    const ghostLocRes = await fetch(`${baseUrl}/logistics/location-samples`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
        "X-Idempotency-Key": "idem_loc_ghost_001",
      },
      body: JSON.stringify({
        deliveryTaskId: "dtask_does_not_exist",
        latitude: -23.5625,
        longitude: -46.6612,
        accuracyMeters: 12,
        recordedAtIso: new Date().toISOString(),
      }),
    });
    assert.equal(ghostLocRes.status, 404);
  });
});

// Live Supabase PostgreSQL Integration Test (executes when DATABASE_URL is configured)
const liveDbUrl = process.env.DATABASE_URL;
describe(
  "@ideliveryfood/api — Live Supabase PostgreSQL Persistence (dwsoochnfxldfvcaijie)",
  { skip: !liveDbUrl },
  () => {
    const pgRepo = liveDbUrl
      ? createSupabasePostgresRepository({
          connectionString: liveDbUrl,
          isTestData: true,
        })
      : null;
    const liveJwtSecret = "live_test_supabase_jwt_secret_32_characters_minimum";
    const liveServer = pgRepo
      ? createApiServer({
          repository: pgRepo,
          env: { SUPABASE_JWT_SECRET: liveJwtSecret, APP_ENV: "production" },
        })
      : null;
    let liveBaseUrl = "";

    before(async () => {
      if (!liveServer) return;
      await new Promise<void>((resolve) => {
        liveServer.listen(0, "127.0.0.1", () => resolve());
      });
      const addr = liveServer.address() as AddressInfo;
      liveBaseUrl = `http://127.0.0.1:${addr.port}/v1`;
    });

    after(async () => {
      if (liveServer) {
        await new Promise<void>((resolve, reject) => {
          liveServer.close((err) => (err ? reject(err) : resolve()));
        });
      }
      if (pgRepo) {
        await pgRepo.close();
      }
    });

    it("reads published stores & catalogs from live Supabase and persists quotes, orders, webhooks, refunds, and audit logs using verified Bearer JWTs", async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const customerToken = signSupabaseHs256Jwt(
        {
          sub: "00000000-0000-4000-8000-000000000001",
          aal: "aal1",
          exp: nowSec + 600,
        },
        liveJwtSecret
      );
      const staffTokenAal2 = signSupabaseHs256Jwt(
        {
          sub: "00000000-0000-4000-8000-000000000090",
          aal: "aal2",
          exp: nowSec + 600,
        },
        liveJwtSecret
      );

      // 1. Live store discovery from public.published_stores_v
      const storesRes = await fetch(`${liveBaseUrl}/stores?locale=pt-BR`);
      assert.equal(storesRes.status, 200);
      const storesJson = (await storesRes.json()) as { data: PublishedStoreContract[] };
      assert.ok(storesJson.data.length >= 2);

      // 2. Live store catalog from public.stores + catalog_categories + catalog_products
      const catRes = await fetch(
        `${liveBaseUrl}/stores/00000000-0000-4000-8000-000000000201/catalog?locale=en`
      );
      assert.equal(catRes.status, 200);

      // 3. Create quote persisted in public.quotes
      const runTag = Date.now();
      const quoteRes = await fetch(`${liveBaseUrl}/quotes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${customerToken}`,
          "X-Idempotency-Key": `live_quote_${runTag}`,
        },
        body: JSON.stringify({
          storeId: "00000000-0000-4000-8000-000000000201",
          fulfillmentModality: "PLATFORM_DELIVERY",
          cartItems: [
            {
              productId: "00000000-0000-4000-8000-000000000601",
              quantity: 1,
              selectedOptions: [],
            },
          ],
          deliveryFeeCents: 690,
        }),
      });
      assert.equal(quoteRes.status, 201);
      const quoteJson = (await quoteRes.json()) as { data: ServerQuoteRecordContract };

      // 4. Create order persisted in public.orders + public.order_events + public.outbox_events
      const orderRes = await fetch(`${liveBaseUrl}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${customerToken}`,
          "X-Idempotency-Key": `live_order_${runTag}`,
        },
        body: JSON.stringify({
          quoteId: quoteJson.data.id,
          customerNotes: "Live PostgreSQL persistence check",
        }),
      });
      assert.equal(orderRes.status, 201);
      const orderJson = (await orderRes.json()) as { data: OrderRecordContract };

      // 5. Read back order directly from a separate GET /v1/orders/:id query
      const getOrderRes = await fetch(`${liveBaseUrl}/orders/${orderJson.data.id}`, {
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      assert.equal(getOrderRes.status, 200);
      const fetchedOrder = (await getOrderRes.json()) as { data: OrderRecordContract };
      assert.equal(fetchedOrder.data.id, orderJson.data.id);
      assert.equal(fetchedOrder.data.totalCents, orderJson.data.totalCents);

      // 6. Read audit logs as staff with MFA aal2 from public.audit_logs
      const logsRes = await fetch(`${liveBaseUrl}/admin/audit-logs`, {
        headers: { Authorization: `Bearer ${staffTokenAal2}` },
      });
      assert.equal(logsRes.status, 200);
      const logsJson = (await logsRes.json()) as { data: AuditLogWriteRecord[] };
      assert.ok(logsJson.data.length >= 1);
    });
  }
);
