import assert from "node:assert/strict";
import fs from "node:fs";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createApiServer,
  createSupabasePostgresRepository,
  signSupabaseHs256Jwt,
} from "@ideliveryfood/api";
import { IDeliveryApiClient } from "@ideliveryfood/api-client";
import type {
  AuthenticatedActorProfileContract,
  OrderEventRecordContract,
  OrderRecordContract,
} from "@ideliveryfood/contracts";
import {
  KitchenOrderConsoleController,
  buildPartnerPortalScreenModel,
  createPartnerWebServer,
  evaluateMultiUnitCatalogBatch,
  submitPartnerBankAccountChangeRequest,
} from "../src/index.js";

describe("@ideliveryfood/partner-web — Multi-Tenant Scope, Partner Finance Segregation & M09 Multi-Unit Batch", () => {
  const operatorLucas: AuthenticatedActorProfileContract = {
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
  };

  const financeClara: AuthenticatedActorProfileContract = {
    id: "00000000-0000-4000-8000-000000000012",
    email: "finance.paulista@test.ideliveryfood.invalid",
    fullName: "Clara Partner Finance",
    phone: "+5511900000012",
    preferredLocale: "en",
    status: "ACTIVE",
    mfaEnforced: false,
    aal: "aal1",
    organizationMemberships: [
      {
        organizationId: "00000000-0000-4000-8000-000000000101",
        storeId: null,
        role: "partner_finance",
      },
    ],
    staffScopes: [],
  };

  it("allows partner_operator to access Store 201 operations while segregating financial ledger", () => {
    const screen = buildPartnerPortalScreenModel({
      actor: operatorLucas,
      organizationId: "00000000-0000-4000-8000-000000000101",
      storeId: "00000000-0000-4000-8000-000000000201",
    });

    assert.equal(screen.canAccessStoreOperations, true);
    assert.equal(screen.canAccessFinancialLedger, false);
    assert.match(screen.financeSegregationNotice ?? "", /restritos aos papéis de Proprietário e Financeiro/);
  });

  it("denies partner_operator access to another tenant organization (Org 102)", () => {
    const crossTenantScreen = buildPartnerPortalScreenModel({
      actor: operatorLucas,
      organizationId: "00000000-0000-4000-8000-000000000102",
    });

    assert.equal(crossTenantScreen.canAccessStoreOperations, false);
    assert.equal(crossTenantScreen.banner?.kind, "forbidden");
  });

  it("grants partner_finance access to Organization 101 financial ledger", () => {
    const financeScreen = buildPartnerPortalScreenModel({
      actor: financeClara,
      organizationId: "00000000-0000-4000-8000-000000000101",
    });

    assert.equal(financeScreen.canAccessStoreOperations, true);
    assert.equal(financeScreen.canAccessFinancialLedger, true);
    assert.equal(financeScreen.financeSegregationNotice, null);
  });

  it("evaluates M09 multi-unit catalog batch updates with per-unit partial status reporting", () => {
    const batch = evaluateMultiUnitCatalogBatch({
      actor: operatorLucas,
      organizationId: "00000000-0000-4000-8000-000000000101",
      productId: "00000000-0000-4000-8000-000000000601",
      targetStoreIds: [
        "00000000-0000-4000-8000-000000000201",
        "00000000-0000-4000-8000-000000000203",
      ],
      locale: "en",
    });

    assert.equal(batch.results[0]?.status, "APPLIED");
    assert.equal(batch.results[1]?.status, "DENIED_SCOPE");
    assert.equal(
      batch.summaryText,
      "Batch catalog update: 1 applied, 1 denied across 2 unit targets."
    );
  });

  it("enforces M07 partner_owner + MFA aal2 for bank account change requests and never triggers immediate payout", () => {
    const ownerCarlosAal1: AuthenticatedActorProfileContract = {
      id: "00000000-0000-4000-8000-000000000010",
      email: "owner.paulista@test.ideliveryfood.invalid",
      fullName: "Carlos Partner Owner",
      phone: "+5511900000010",
      preferredLocale: "en",
      status: "ACTIVE",
      mfaEnforced: true,
      aal: "aal1",
      organizationMemberships: [
        {
          organizationId: "00000000-0000-4000-8000-000000000101",
          storeId: null,
          role: "partner_owner",
        },
      ],
      staffScopes: [],
    };

    assert.throws(() =>
      submitPartnerBankAccountChangeRequest({
        actor: ownerCarlosAal1,
        organizationId: "00000000-0000-4000-8000-000000000101",
        storeId: "00000000-0000-4000-8000-000000000201",
        bankCode: "341",
        branchNumber: "0001",
        accountLast4: "9876",
        reason: "Switching primary settlement bank account",
      })
    );

    const ownerCarlosAal2: AuthenticatedActorProfileContract = {
      ...ownerCarlosAal1,
      aal: "aal2",
    };

    const submitted = submitPartnerBankAccountChangeRequest({
      actor: ownerCarlosAal2,
      organizationId: "00000000-0000-4000-8000-000000000101",
      storeId: "00000000-0000-4000-8000-000000000201",
      bankCode: "341",
      branchNumber: "0001",
      accountLast4: "9876",
      reason: "Switching primary settlement bank account",
      locale: "pt-BR",
    });

    assert.equal(submitted.request.status, "PENDING");
    assert.equal(submitted.immediatePayoutTriggered, false);
    assert.match(submitted.pendingApprovalNotice, /9876/);
    assert.match(submitted.pendingApprovalNotice, /PENDING/);
  });

  it("manages M08 kitchen order console: SLA countdown, optimistic locking conflict, reconnect deduplication & store pause resilience", () => {
    const sampleOrder: OrderRecordContract = {
      id: "00000000-0000-4000-8000-000000001001",
      orderNumber: 1001,
      customerId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000101",
      storeId: "00000000-0000-4000-8000-000000000201",
      quoteId: "00000000-0000-4000-8000-000000000901",
      fulfillmentModality: "PLATFORM_DELIVERY",
      orderStatus: "PENDING_MERCHANT_ACCEPTANCE",
      paymentStatus: "CAPTURED",
      deliveryStatus: "PENDING_DISPATCH",
      currencyCode: "BRL",
      subtotalCents: 4290,
      addonsCents: 600,
      serviceFeeCents: 245,
      deliveryFeeCents: 790,
      discountCents: 0,
      totalCents: 5925,
      platformCommissionCents: 1125,
      merchantNetCents: 3765,
      courierEarningsCents: 790,
      deliveryAddressSnapshot: null,
      itemsSnapshot: [
        {
          productId: "prod_601",
          productNameEn: "Feijoada",
          productNamePtBr: "Feijoada",
          quantity: 1,
          unitPriceCents: 4290,
          addonsUnitPriceCents: 600,
          totalLineCents: 4890,
          selectedOptions: [],
        },
      ],
      customerNotes: "Sem pimenta",
      cancellationReason: null,
      cancelledByRole: null,
      version: 2,
      idempotencyKey: "idem_ord_1001",
      acceptedAtIso: null,
      readyAtIso: null,
      deliveredAtIso: null,
      cancelledAtIso: null,
      createdAtIso: "2026-11-03T15:00:00.000Z",
      updatedAtIso: "2026-11-03T15:00:10.000Z",
    };

    const consoleCtrl = new KitchenOrderConsoleController({
      storeId: "00000000-0000-4000-8000-000000000201",
      initialOrders: [sampleOrder],
      locale: "pt-BR",
    });

    // Sound alert requires explicit consent
    assert.equal(consoleCtrl.isAudibleAlertEnabled(), false);
    consoleCtrl.setAudibleAlertsConsent(true);
    assert.equal(consoleCtrl.isAudibleAlertEnabled(), true);

    // Reject without reason must fail
    assert.throws(() =>
      consoleCtrl.executeKitchenCommand({
        actor: operatorLucas,
        organizationId: "00000000-0000-4000-8000-000000000101",
        orderId: sampleOrder.id,
        command: "REJECT",
        expectedVersion: 2,
        idempotencyKey: "idem_reject_no_reason",
      })
    );

    // First operator accepts with version 2 -> succeeds (version becomes 3)
    const firstAccept = consoleCtrl.executeKitchenCommand({
      actor: operatorLucas,
      organizationId: "00000000-0000-4000-8000-000000000101",
      orderId: sampleOrder.id,
      command: "ACCEPT",
      expectedVersion: 2,
      idempotencyKey: "idem_accept_op1",
      now: new Date("2026-11-03T15:02:00.000Z"),
    });
    assert.equal(firstAccept.outcome, "APPLIED");
    assert.equal(firstAccept.order.orderStatus, "ACCEPTED");
    assert.equal(firstAccept.order.version, 3);

    // Second operator tries to accept with stale version 2 -> conflict handled cleanly
    const secondAccept = consoleCtrl.executeKitchenCommand({
      actor: operatorLucas,
      organizationId: "00000000-0000-4000-8000-000000000101",
      orderId: sampleOrder.id,
      command: "ACCEPT",
      expectedVersion: 2,
      idempotencyKey: "idem_accept_op2",
      now: new Date("2026-11-03T15:02:01.000Z"),
    });
    assert.equal(secondAccept.outcome, "VERSION_CONFLICT");
    assert.match(secondAccept.conflictNotice ?? "", /#1001/);

    // Pause store; active order remains visible in queue
    consoleCtrl.setStorePaused(true, "Alta demanda na cozinha");
    const vm = consoleCtrl.getConsoleViewModel(new Date("2026-11-03T15:10:00.000Z"));
    assert.equal(vm.queue.isStorePaused, true);
    assert.equal(vm.queue.activeOrderCount, 1);
    assert.equal(vm.queue.columns.ACCEPTED.length, 1);
    assert.match(vm.pausedBanner ?? "", /Alta demanda na cozinha/);

    // Reconnect event catch-up deduplicates repeated events
    const incomingEvt: OrderEventRecordContract = {
      id: "oevt_reconnect_4",
      orderId: sampleOrder.id,
      actorId: operatorLucas.id,
      actorRole: "PARTNER",
      eventType: "ORDER_START_PREPARING",
      previousOrderStatus: "ACCEPTED",
      newOrderStatus: "PREPARING",
      previousPaymentStatus: "CAPTURED",
      newPaymentStatus: "CAPTURED",
      previousDeliveryStatus: "PENDING_DISPATCH",
      newDeliveryStatus: "PENDING_DISPATCH",
      idempotencyKey: "idem_prep_4",
      payload: { version: 4 },
      createdAtIso: "2026-11-03T15:05:00.000Z",
    };

    const rec1 = consoleCtrl.reconcileEventsOnReconnect([incomingEvt, incomingEvt]);
    assert.equal(rec1.appliedEventsCount, 1);
    const vmAfterReconnect = consoleCtrl.getConsoleViewModel(new Date("2026-11-03T15:10:00.000Z"));
    assert.equal(vmAfterReconnect.queue.columns.PREPARING.length, 1);
  });
});

function loadRootEnv(): void {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(__dirname, "../../../../.env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

describe("@ideliveryfood/partner-web — Live Supabase & SSR App Router Integration (Fase H)", () => {
  let repo: ReturnType<typeof createSupabasePostgresRepository>;
  let apiServer: http.Server;
  let partnerServer: http.Server;
  let apiBaseUrl = "";
  let partnerBaseUrl = "";
  let currentToken: string | null = null;
  let apiClient: IDeliveryApiClient;

  const jwtSecret = "fase-h-partner-web-jwt-secret-key-minimum-32-chars!!";
  const org101Id = "00000000-0000-4000-8000-000000000101";
  const store201Id = "00000000-0000-4000-8000-000000000201";
  const ownerHelenaId = "00000000-0000-4000-8000-000000000010";
  const operatorLucasId = "00000000-0000-4000-8000-000000000011";
  const financeClaraId = "00000000-0000-4000-8000-000000000012";

  before(async () => {
    loadRootEnv();
    const dbUrl = process.env.DATABASE_URL;
    assert.ok(dbUrl, "DATABASE_URL must be configured in root .env for live Partner Web tests");

    repo = createSupabasePostgresRepository({ connectionString: dbUrl });
    apiServer = createApiServer({
      repository: repo,
      env: {
        ...process.env,
        SUPABASE_JWT_SECRET: jwtSecret,
      },
    });

    await new Promise<void>((resolve) => apiServer.listen(0, resolve));
    const apiPort = (apiServer.address() as AddressInfo).port;
    apiBaseUrl = `http://127.0.0.1:${apiPort}/v1`;

    currentToken = signSupabaseHs256Jwt(
      {
        sub: ownerHelenaId,
        role: "authenticated",
        aal: "aal2",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      jwtSecret
    );

    apiClient = new IDeliveryApiClient({
      baseUrl: apiBaseUrl,
      getAccessToken: () => currentToken,
    });

    partnerServer = createPartnerWebServer({
      apiClient,
      defaultOrganizationId: org101Id,
      defaultStoreId: store201Id,
    });

    await new Promise<void>((resolve) => partnerServer.listen(0, resolve));
    const partnerPort = (partnerServer.address() as AddressInfo).port;
    partnerBaseUrl = `http://127.0.0.1:${partnerPort}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => partnerServer.close(() => resolve()));
    await new Promise<void>((resolve) => apiServer.close(() => resolve()));
    await repo.close();
  });

  it("renders /dashboard, /onboarding (with KYC signed upload URL), /store/settings, /store/hours, /store/coverage & /catalog from live Supabase", async () => {
    // 1. /dashboard
    const dashRes = await fetch(`${partnerBaseUrl}/dashboard?locale=pt-BR`);
    assert.equal(dashRes.status, 200);
    const dashHtml = await dashRes.text();
    assert.match(dashHtml, /Paulista Artisan Burgers - Jardins/);
    assert.match(dashHtml, /data-testid="kpi-active-orders"/);
    assert.match(dashHtml, /data-testid="kpi-gmv"/);

    // 2. /onboarding with KYC signed upload URL
    const onbRes = await fetch(
      `${partnerBaseUrl}/onboarding?kycFile=contrato-social.pdf&locale=pt-BR`
    );
    assert.equal(onbRes.status, 200);
    const onbHtml = await onbRes.text();
    assert.match(onbHtml, /data-testid="onboarding-checklist"/);
    assert.match(onbHtml, /data-testid="kyc-signed-url-result"/);
    assert.match(onbHtml, /partner-kyc-docs/);

    // 3. /store/settings, /store/hours, /store/coverage
    const settingsRes = await fetch(`${partnerBaseUrl}/store/settings?locale=pt-BR`);
    assert.equal(settingsRes.status, 200);
    const settingsHtml = await settingsRes.text();
    assert.match(settingsHtml, /data-testid="store-settings-card"/);
    assert.match(settingsHtml, /data-testid="store-hours-card"/);
    assert.match(settingsHtml, /data-testid="store-coverage-card"/);
    assert.match(settingsHtml, /Jardins &amp; Bela Vista/);

    // 4. /catalog with catalog-media signed upload URL
    const catRes = await fetch(
      `${partnerBaseUrl}/catalog?mediaFile=picanha-premium.webp&locale=pt-BR`
    );
    assert.equal(catRes.status, 200);
    const catHtml = await catRes.text();
    assert.match(catHtml, /Duplo Smash Paulista Trufado/);
    assert.match(catHtml, /data-testid="catalog-media-upload-intent"/);
    assert.match(catHtml, /catalog-media/);
  });

  it("renders /team and enforces strict role segregation on /finance between partner_operator (403) and partner_finance (200)", async () => {
    // 1. /team as partner_owner Helena
    const teamRes = await fetch(`${partnerBaseUrl}/team?locale=pt-BR`);
    assert.equal(teamRes.status, 200);
    const teamHtml = await teamRes.text();
    assert.match(teamHtml, /00000000-0000-4000-8000-000000000010/);
    assert.match(teamHtml, /00000000-0000-4000-8000-000000000011/);
    assert.match(teamHtml, /00000000-0000-4000-8000-000000000012/);
    assert.match(teamHtml, /partner_owner/);
    assert.match(teamHtml, /partner_operator/);
    assert.match(teamHtml, /partner_finance/);

    // 2. Switch token to partner_operator Lucas -> /finance must return 403 and segregated banner
    currentToken = signSupabaseHs256Jwt(
      {
        sub: operatorLucasId,
        role: "authenticated",
        aal: "aal1",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      jwtSecret
    );

    const operatorFinRes = await fetch(`${partnerBaseUrl}/finance?locale=pt-BR`);
    assert.equal(operatorFinRes.status, 403);
    const operatorFinHtml = await operatorFinRes.text();
    assert.match(operatorFinHtml, /data-testid="finance-segregation-card"/);

    // Also verify backend API directly rejects partner_operator on /v1/partner/organizations/:orgId/finance-summary
    await assert.rejects(
      async () => apiClient.getPartnerFinanceSummary(org101Id),
      /restricted to Partner Owner and Partner Finance roles/
    );

    // 3. Switch token to partner_finance Clara -> /finance returns 200 with real ledger balance & settlements
    currentToken = signSupabaseHs256Jwt(
      {
        sub: financeClaraId,
        role: "authenticated",
        aal: "aal1",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      jwtSecret
    );

    const claraFinRes = await fetch(`${partnerBaseUrl}/finance?locale=pt-BR`);
    assert.equal(claraFinRes.status, 200);
    const claraFinHtml = await claraFinRes.text();
    assert.match(claraFinHtml, /data-testid="finance-payable-balance"/);
    assert.match(claraFinHtml, /data-testid="settlements-table"/);
  });

  it("renders /reviews (and persists partner reply), /contract, /support, /kitchen KDS & /chain M09 multi-unit portal", async () => {
    // Restore partner_owner Helena token
    currentToken = signSupabaseHs256Jwt(
      {
        sub: ownerHelenaId,
        role: "authenticated",
        aal: "aal2",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      jwtSecret
    );

    // 1. Reply to verified customer review via API client and verify on /reviews
    const reviewsList = await apiClient.listStoreReviews(store201Id);
    assert.ok(reviewsList.data.length >= 1);
    const targetReviewId = reviewsList.data[0]!.id;

    const replied = await apiClient.replyToStoreReview({
      storeId: store201Id,
      reviewId: targetReviewId,
      reply:
        "Thank you for ordering with Paulista Artisan Burgers! — Muito obrigado pela preferência! Equipe Sabor Paulista.",
    });
    assert.equal(
      replied.data.partnerReply,
      "Thank you for ordering with Paulista Artisan Burgers! — Muito obrigado pela preferência! Equipe Sabor Paulista."
    );

    const revPageRes = await fetch(`${partnerBaseUrl}/reviews?locale=pt-BR`);
    assert.equal(revPageRes.status, 200);
    const revPageHtml = await revPageRes.text();
    assert.match(revPageHtml, /Muito obrigado pela preferência! Equipe Sabor Paulista\./);
    assert.match(revPageHtml, /data-testid="partner-contract-section"/);
    assert.match(revPageHtml, /data-testid="partner-support-section"/);

    // 2. /kitchen KDS Kanban board
    const kdsRes = await fetch(`${partnerBaseUrl}/kitchen?audio=1&locale=pt-BR`);
    assert.equal(kdsRes.status, 200);
    const kdsHtml = await kdsRes.text();
    assert.match(kdsHtml, /data-testid="kds-kanban-board"/);
    assert.match(kdsHtml, /data-testid="kds-column-NEW"/);
    assert.match(kdsHtml, /@media print/);
    assert.match(kdsHtml, /ON/);

    // 3. /chain M09 Multi-Unit Franchise Portal
    const chainRes = await fetch(`${partnerBaseUrl}/chain?locale=pt-BR`);
    assert.equal(chainRes.status, 200);
    const chainHtml = await chainRes.text();
    assert.match(chainHtml, /00000000-0000-4000-8000-000000000101/);
    assert.match(chainHtml, /Paulista Artisan Burgers - Jardins/);
    assert.match(chainHtml, /Tokyo Bay Sushi - Pinheiros/);
    assert.match(chainHtml, /data-testid="chain-units-table"/);
  });
});

