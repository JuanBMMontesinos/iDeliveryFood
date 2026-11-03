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

  it("handles Fase C endpoints: M07 store pause settings, M08 kitchen orders queue, and M16 admin self-grant prohibition & audit logs", async () => {
    // 1. Partner Operator pauses Store 201 with mandatory reason (M07)
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

    // 2. Kitchen orders queue remains accessible and shows active orders while paused (M08)
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

    // 3. Tech Admin attempts to self-grant a staff scope -> blocked with 403 DENIED_SELF_GRANT_FORBIDDEN (M16)
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

    // 4. Tech Admin reads immutable audit logs at aal2 (M16)
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
    // 0. Operations staff (non-finance) is denied PSP reconciliation even at aal2 (M13 RBAC)
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

    // 0b. Finance staff at aal1 is denied (MFA aal2 step-up required)
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

    // 1. Finance Staff runs PSP Reconciliation at aal2 (M13)
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

    // 2. Settlement Payout Execution: Segregation of Duties violation returns 403
    const sodViolationRes = await fetch(`${baseUrl}/finance/settlements/settle_001/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000091",
        "X-Actor-Aal": "aal2",
        "X-Idempotency-Key": "idem_settle_sod_001",
      },
      body: JSON.stringify({
        providerCode: "stripe",
        bankAccountApprovedByActorId: "00000000-0000-4000-8000-000000000091", // Same actor!
      }),
    });
    assert.equal(sodViolationRes.status, 403);

    // 3. Settlement Payout Execution with different approver & unconfigured PSP returns honest BLOCKED_NO_PSP
    const blockedSettleRes = await fetch(`${baseUrl}/finance/settlements/settle_001/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000091",
        "X-Actor-Aal": "aal2",
        "X-Idempotency-Key": "idem_settle_ok_001",
      },
      body: JSON.stringify({
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

    // 4a. A courier/customer actor (no staff scope) cannot create dispatch offers
    const offerForbiddenRes = await fetch(`${baseUrl}/logistics/offers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Id": "00000000-0000-4000-8000-000000000001",
      },
      body: JSON.stringify({ deliveryTaskId: "dtask_forbidden", offerId: "doff_forbidden" }),
    });
    assert.equal(offerForbiddenRes.status, 403);

    // 4. Create delivery task and offer (M14): full customer address is hidden prior to acceptance
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

    // 5. Courier accepts offer transactionally (M11/M14): reveals full dropoff address
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

    // 6. Second offer acceptance on the same task returns 409 Conflict
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

    // 7. Submit courier GPS location sample (M11/M14)
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

    // 8. Complete delivery task with wrong OTP returns 409, then right OTP ("4829") returns 200 DELIVERED
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

    // 9. Re-completing an already delivered task returns 409 (no double completion)
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

    // 10. GPS sample referencing a nonexistent task returns 404 (never silently accepted)
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
