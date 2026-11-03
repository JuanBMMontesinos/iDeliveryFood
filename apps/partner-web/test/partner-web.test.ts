import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AuthenticatedActorProfileContract,
  OrderEventRecordContract,
  OrderRecordContract,
} from "@ideliveryfood/contracts";
import {
  KitchenOrderConsoleController,
  buildPartnerPortalScreenModel,
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
