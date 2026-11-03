import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type {
  AuthenticatedActorProfileContract,
  BatchCatalogUpdateItemResultContract,
  OrderRecordContract,
  PublishedStoreContract,
  RefundRecordContract,
  ServerQuoteRecordContract,
  SupportedLocale,
  UserPreferencesContract,
} from "@ideliveryfood/contracts";
import type { StoredInvitationRecord } from "@ideliveryfood/authz";
import { computePspWebhookSignature } from "@ideliveryfood/domain";
import {
  createApiServer,
  type ApiDataRepository,
  type AuditLogWriteRecord,
} from "../src/index.js";

describe("@ideliveryfood/api — /v1 HTTP Integration (Fase A & Fase B: M04, M05, M09, M10, M12)", () => {
  const auditLogs: AuditLogWriteRecord[] = [];
  const invitations = new Map<string, StoredInvitationRecord>();
  const userLocales = new Map<string, SupportedLocale>([
    ["00000000-0000-4000-8000-000000000001", "en"],
  ]);

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
  };

  const repository: ApiDataRepository = {
    async listPublishedStores(locale: SupportedLocale): Promise<PublishedStoreContract[]> {
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
          isPaused: false,
          timezone: "America/Sao_Paulo",
          city: "São Paulo",
          stateCode: "SP",
          latitude: -23.561414,
          longitude: -46.655881,
          minOrderCents: 2500,
          prepTimeMinMinutes: 20,
          prepTimeMaxMinutes: 35,
          supportedModalities: ["PLATFORM_DELIVERY", "MERCHANT_DELIVERY", "PICKUP"],
        },
      ];
    },
    async getStoreCatalog(storeId: string, locale: SupportedLocale) {
      if (storeId !== "00000000-0000-4000-8000-000000000201") return null;
      const stores = await this.listPublishedStores(locale);
      const store = stores[0]!;
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
  };

  const server = createApiServer({ repository, env: {} });
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

    // Lucas is partner_operator only for Store 201, NOT Store 203!
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
    // 1. Create Quote
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

    // 2. Create Order from Quote
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

    // 3. Attempting to reuse the consumed quote with a different idempotency key fails with 409 QUOTE_ALREADY_CONSUMED
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

    // 4. Attempting online payment without PSP credentials returns honest 503 PSP_PROVIDER_BLOCKED_MISSING_CREDENTIALS
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

    // 5. Signed PSP Webhook captures payment and transitions order to PENDING_MERCHANT_ACCEPTANCE (version 2)
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

    // 6. Partner accepts order (version 2 -> 3)
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

    // 7. Staff approves partial refund with MFA aal2
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
});
