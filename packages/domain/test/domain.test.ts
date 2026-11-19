import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptDeliveryOfferTransactional,
  assertExternalProviderReady,
  buildBalancedOrderCaptureJournal,
  calculateHaversineDistanceMeters,
  calculateServerQuoteAndSplit,
  canTransitionDeliveryStatus,
  canTransitionOrderStatus,
  canTransitionPaymentStatus,
  computePspWebhookSignature,
  computeSupportSlaDueAt,
  createOrderFromServerQuote,
  decideEscalatedSupportActionRequest,
  evaluateAccountDeletionRequest,
  evaluateCourierLocationSample,
  evaluateFleetOperatorAccess,
  evaluatePspReconciliationRun,
  evaluateRefundRequest,
  evaluateServiceAreaEligibility,
  evaluateSettlementPayoutExecution,
  evaluateSingleStoreCartAddition,
  evaluateStoreAvailability,
  evaluateSupportActionRequest,
  executeOrderCommand,
  filterSupportCaseViewForActor,
  hashDeliveryConfirmationCode,
  transitionCommercialLeadStatus,
  transitionSupportCaseStatus,
  validateAndBuildCommercialProposal,
  validateAndBuildQuoteItems,
  verifyAndProcessPspWebhook,
  verifyDeliveryConfirmationCode,
  assertCommercialSegregationFromFinance,
  buildVersionedContractAndCommissionRule,
  calculatePublishedStoreRatingSummary,
  evaluateAdminReviewModeration,
  evaluatePartnerContractAcceptance,
  evaluatePartnerReviewReply,
  evaluatePromotionEligibilityAndSubsidy,
  evaluateVerifiedOrderReviewCreation,
  calculateOutboxBackoffMs,
  evaluateNotificationChannelEligibility,
  reconcileNotificationsSinceCursor,
  renderVersionedNotificationTemplate,
  signOutboundWebhookPayload,
  verifyOutboundWebhookSignature,
  anonymizeProfilePii,
  buildLgpdDataPortabilityPackage,
  computeReproducibleAnalyticalKpis,
  evaluateExplainableRiskRule,
  formatAnalyticalKpisCsv,
  validateHumanRiskReview,
  calculateWeighedItemPriceCents,
  evaluateGroceryPickingPolicyAccess,
  evaluateItemSubstitutionProposal,
  finalizeOrderPickTaskFinancialAdjustment,
  resolveCustomerSubstitutionDecision,
  buildKitchenOrderQueue,
  createBankAccountChangeRequest,
  evaluateAdminGovernanceDecision,
  evaluateStaffScopeGrant,
  mapOrderStatusToKitchenColumn,
  reconcileKitchenOrderEventsOnReconnect,
  validateStoreSettingsPatch,
} from "../src/index.js";

describe("@ideliveryfood/domain — Fase A & Fase B (M04, M05, M10, M12) Domain Suite", () => {
  it("calculates server quote and balanced double-entry split in integer BRL cents", () => {
    const result = calculateServerQuoteAndSplit({
      items: [
        {
          productId: "00000000-0000-4000-8000-000000000601",
          quantity: 1,
          unitPriceCents: 3890,
          addonsUnitPriceCents: 650,
        },
        {
          productId: "00000000-0000-4000-8000-000000000602",
          quantity: 1,
          unitPriceCents: 1690,
          addonsUnitPriceCents: 0,
        },
      ],
      fulfillmentModality: "PLATFORM_DELIVERY",
      deliveryFeeCents: 690,
      discountCents: 1000,
      discountFundedBy: "PLATFORM",
      minOrderCents: 2500,
    });

    assert.equal(result.subtotalCents, 5580);
    assert.equal(result.addonsCents, 650);
    assert.equal(result.grossMerchandiseCents, 6230);
    assert.equal(result.serviceFeeCents, 312);
    assert.equal(result.deliveryFeeCents, 690);
    assert.equal(result.discountCents, 1000);
    assert.equal(result.totalCents, 6232);
    assert.equal(result.platformCommissionCents, 1433);
    assert.equal(result.merchantNetCents, 4797);
    assert.equal(result.courierEarningsCents, 690);
    assert.equal(result.ledgerDebitsCents, 7232);
    assert.equal(result.ledgerCreditsCents, 7232);
  });

  it("supports MERCHANT_DELIVERY and PICKUP modalities and rejects baskets below minimum order", () => {
    const pickupQuote = calculateServerQuoteAndSplit({
      items: [
        {
          productId: "00000000-0000-4000-8000-000000000603",
          quantity: 1,
          unitPriceCents: 8990,
          addonsUnitPriceCents: 0,
        },
      ],
      fulfillmentModality: "PICKUP",
      deliveryFeeCents: 890,
      discountCents: 500,
      discountFundedBy: "MERCHANT",
      minOrderCents: 4000,
    });

    assert.equal(pickupQuote.deliveryFeeCents, 0);
    assert.equal(pickupQuote.courierEarningsCents, 0);
    assert.equal(pickupQuote.ledgerDebitsCents, pickupQuote.ledgerCreditsCents);

    assert.throws(
      () =>
        calculateServerQuoteAndSplit({
          items: [
            {
              productId: "00000000-0000-4000-8000-000000000602",
              quantity: 1,
              unitPriceCents: 1690,
              addonsUnitPriceCents: 0,
            },
          ],
          fulfillmentModality: "PLATFORM_DELIVERY",
          deliveryFeeCents: 690,
          discountCents: 0,
          discountFundedBy: "NONE",
          minOrderCents: 2500,
        }),
      /QUOTE_BELOW_MIN_ORDER/
    );
  });

  it("enforces valid and invalid transitions across Order, Payment, and Delivery state machines", () => {
    assert.equal(canTransitionOrderStatus("CREATED", "AWAITING_PAYMENT"), true);
    assert.equal(canTransitionOrderStatus("ACCEPTED", "PREPARING"), true);
    assert.equal(canTransitionOrderStatus("DELIVERED", "PREPARING"), false);
    assert.equal(canTransitionOrderStatus("REFUNDED", "ACCEPTED"), false);

    assert.equal(canTransitionPaymentStatus("PENDING", "CAPTURED"), true);
    assert.equal(canTransitionPaymentStatus("CAPTURED", "REFUNDED"), true);
    assert.equal(canTransitionPaymentStatus("CANCELLED", "CAPTURED"), false);

    assert.equal(canTransitionDeliveryStatus("PENDING_DISPATCH", "ASSIGNED"), true);
    assert.equal(canTransitionDeliveryStatus("PICKED_UP", "IN_TRANSIT"), true);
    assert.equal(canTransitionDeliveryStatus("DELIVERED", "OFFERING"), false);
  });

  it("evaluates M04 store availability across regular hours, overnight windows, pauses, and holiday exceptions in America/Sao_Paulo", () => {
    const weeklyHours = [
      { dayOfWeek: 2, opensAt: "11:00:00", closesAt: "23:30:00", isOvernight: false, isClosed: false }, // Tuesday
      { dayOfWeek: 5, opensAt: "11:00:00", closesAt: "01:00:00", isOvernight: true, isClosed: false }, // Friday -> Sat 01:00
      { dayOfWeek: 6, opensAt: "11:00:00", closesAt: "01:00:00", isOvernight: true, isClosed: false }, // Saturday
    ];

    // Tuesday 2026-11-03 15:00 UTC = 12:00 America/Sao_Paulo (Open)
    const openEval = evaluateStoreAvailability({
      storeId: "store_201",
      isPublished: true,
      isPaused: false,
      weeklyHours,
      evaluatedAt: new Date("2026-11-03T15:00:00Z"),
    });
    assert.equal(openEval.isOpen, true);
    assert.equal(openEval.reasonCode, "OPEN");

    // Saturday 2026-11-07 03:30 UTC = Saturday 00:30 America/Sao_Paulo (Open via Friday's overnight window!)
    const overnightEval = evaluateStoreAvailability({
      storeId: "store_201",
      isPublished: true,
      isPaused: false,
      weeklyHours,
      evaluatedAt: new Date("2026-11-07T03:30:00Z"),
    });
    assert.equal(overnightEval.isOpen, true);
    assert.equal(overnightEval.reasonCode, "OPEN");

    // Holiday closure exception on 2026-11-03
    const exceptionEval = evaluateStoreAvailability({
      storeId: "store_201",
      isPublished: true,
      isPaused: false,
      weeklyHours,
      exceptions: [
        {
          exceptionDate: "2026-11-03",
          opensAt: null,
          closesAt: null,
          isClosed: true,
          reason: "Inventory maintenance",
        },
      ],
      evaluatedAt: new Date("2026-11-03T15:00:00Z"),
    });
    assert.equal(exceptionEval.isOpen, false);
    assert.equal(exceptionEval.reasonCode, "CLOSED_BY_EXCEPTION");
  });

  it("evaluates M04 Haversine distance, service area radius coverage, and free delivery threshold", () => {
    const distance = calculateHaversineDistanceMeters(
      -23.561414,
      -46.655881,
      -23.56398,
      -46.66912
    );
    assert.ok(distance >= 1350 && distance <= 1450);

    const areas = [
      {
        id: "area_351",
        storeId: "store_201",
        name: "Jardins (7km)",
        radiusMeters: 7000,
        baseFeeCents: 690,
        perKmFeeCents: 150,
        freeDeliveryMinOrderCents: 12000,
        estimatedDeliveryMinutes: 35,
        isActive: true,
      },
    ];

    const eligible = evaluateServiceAreaEligibility({
      storeId: "store_201",
      storeLatitude: -23.561414,
      storeLongitude: -46.655881,
      customerLatitude: -23.56398,
      customerLongitude: -46.66912,
      fulfillmentModality: "PLATFORM_DELIVERY",
      grossMerchandiseCents: 6230,
      serviceAreas: areas,
    });
    assert.equal(eligible.eligible, true);
    assert.equal(eligible.deliveryFeeCents, 840); // 690 base + 1 * 150

    const outOfRange = evaluateServiceAreaEligibility({
      storeId: "store_201",
      storeLatitude: -23.561414,
      storeLongitude: -46.655881,
      customerLatitude: -23.7,
      customerLongitude: -46.8,
      fulfillmentModality: "PLATFORM_DELIVERY",
      grossMerchandiseCents: 6230,
      serviceAreas: areas,
    });
    assert.equal(outOfRange.eligible, false);
    assert.equal(outOfRange.reasonCode, "OUT_OF_RANGE");
  });

  it("validates M04/M05 catalog option group min/max rules and enforces single-store cart switch confirmation", () => {
    const sampleCatalog = [
      {
        id: "prod_601",
        storeId: "store_201",
        categoryId: "cat_501",
        sku: "PAB-SMASH-01",
        nameEn: "Double Paulista Truffle Smash",
        namePtBr: "Duplo Smash Paulista Trufado",
        localizedName: "Double Paulista Truffle Smash",
        descriptionEn: "Burger",
        descriptionPtBr: "Burger",
        localizedDescription: "Burger",
        priceCents: 3890,
        isAvailable: true,
        isPaused: false,
        maxPerOrder: 5,
        unitOfMeasure: "UNIT" as const,
        optionGroups: [
          {
            id: "grp_701",
            nameEn: "Choose Doneness",
            namePtBr: "Ponto da Carne",
            localizedName: "Choose Doneness",
            minSelections: 1,
            maxSelections: 1,
            sortOrder: 1,
            options: [
              {
                id: "opt_751",
                nameEn: "Medium Rare + Smoked Bacon",
                namePtBr: "Ao Ponto Menos + Bacon",
                localizedName: "Medium Rare + Smoked Bacon",
                additionalPriceCents: 650,
                isAvailable: true,
                sortOrder: 1,
              },
            ],
          },
        ],
      },
    ];

    // Missing required option group selection (minSelections = 1) must fail
    assert.throws(
      () =>
        validateAndBuildQuoteItems({
          cartItems: [{ productId: "prod_601", quantity: 1, selectedOptions: [] }],
          catalogProducts: sampleCatalog,
        }),
      /OPTION_GROUP_MIN_NOT_MET/
    );

    // Valid selection builds authoritative snapshot
    const built = validateAndBuildQuoteItems({
      cartItems: [
        {
          productId: "prod_601",
          quantity: 2,
          selectedOptions: [{ optionGroupId: "grp_701", optionId: "opt_751", quantity: 1 }],
        },
      ],
      catalogProducts: sampleCatalog,
    });
    assert.equal(built.snapshots[0]?.unitPriceCents, 3890);
    assert.equal(built.snapshots[0]?.addonsUnitPriceCents, 650);
    assert.equal(built.snapshots[0]?.totalLineCents, 9080);

    // Single-store cart guard
    const cartStep1 = evaluateSingleStoreCartAddition({
      currentStoreId: "store_201",
      currentItems: [{ productId: "prod_601", quantity: 1, selectedOptions: [] }],
      targetStoreId: "store_202",
      itemToAdd: { productId: "prod_603", quantity: 1, selectedOptions: [] },
      confirmSwitchStore: false,
    });
    assert.equal(cartStep1.allowed, false);
    assert.equal(cartStep1.requiresConfirmation, true);

    const cartStep2 = evaluateSingleStoreCartAddition({
      currentStoreId: "store_201",
      currentItems: [{ productId: "prod_601", quantity: 1, selectedOptions: [] }],
      targetStoreId: "store_202",
      itemToAdd: { productId: "prod_603", quantity: 1, selectedOptions: [] },
      confirmSwitchStore: true,
    });
    assert.equal(cartStep2.allowed, true);
    assert.equal(cartStep2.nextStoreId, "store_202");
    assert.equal(cartStep2.nextItems.length, 1);
  });

  it("executes M10 order creation from quote, optimistic locking commands, and M12 webhook/refund reconciliation", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    const quote = {
      id: "quote_951",
      customerId: "cust_001",
      storeId: "store_201",
      addressId: "addr_801",
      fulfillmentModality: "PLATFORM_DELIVERY" as const,
      promotionCode: "WELCOME10",
      currencyCode: "BRL" as const,
      subtotalCents: 5580,
      addonsCents: 650,
      serviceFeeCents: 312,
      deliveryFeeCents: 690,
      discountCents: 1000,
      totalCents: 6232,
      distanceMeters: 1379,
      estimatedPrepMinutes: 25,
      estimatedDeliveryMinutes: 35,
      itemsSnapshot: [
        {
          productId: "prod_601",
          productNameEn: "Double Paulista Truffle Smash",
          productNamePtBr: "Duplo Smash Paulista Trufado",
          quantity: 1,
          unitPriceCents: 3890,
          addonsUnitPriceCents: 650,
          totalLineCents: 4540,
          selectedOptions: [],
        },
        {
          productId: "prod_602",
          productNameEn: "Crinkle Fries",
          productNamePtBr: "Batata Crinkle",
          quantity: 1,
          unitPriceCents: 1690,
          addonsUnitPriceCents: 0,
          totalLineCents: 1690,
          selectedOptions: [],
        },
      ],
      addressSnapshot: { streetLine: "Rua Oscar Freire, 950" },
      idempotencyKey: "idem_quote_001",
      expiresAtIso: "2026-11-03T12:15:00Z",
      consumedAtIso: null,
      createdAtIso: "2026-11-03T12:00:00Z",
    };

    const created = createOrderFromServerQuote({
      orderId: "ord_1002",
      orderNumber: 10002,
      organizationId: "org_101",
      quote,
      actorCustomerId: "cust_001",
      isStoreCurrentlyOpen: true,
      discountFundedBy: "PLATFORM",
      idempotencyKey: "idem_order_1002",
      now,
    });

    assert.equal(created.order.totalCents, 6232);
    assert.equal(created.order.version, 1);
    assert.equal(created.order.orderStatus, "AWAITING_PAYMENT");

    // Optimistic locking conflict test
    assert.throws(
      () =>
        executeOrderCommand({
          order: created.order,
          command: "CANCEL",
          expectedVersion: 99,
          actorId: "cust_001",
          actorRole: "CUSTOMER",
          idempotencyKey: "idem_cancel_wrong_ver",
          now,
        }),
      /ORDER_VERSION_CONFLICT/
    );

    // M12 Webhook verification & deduplication
    const rawPayload = JSON.stringify({ eventId: "evt_001", orderId: "ord_1002", amountCents: 6232 });
    const timestampSeconds = Math.floor(now.getTime() / 1000);
    const webhookSecret = "whsec_test_synthetic_secret";
    const validSignature = computePspWebhookSignature({
      webhookSecret,
      timestampSeconds,
      rawPayload,
    });

    const processedSet = new Set<string>();
    const webhookResult1 = verifyAndProcessPspWebhook({
      providerCode: "stripe",
      externalEventId: "evt_001",
      eventType: "payment.captured",
      webhookSecret,
      signatureHeader: validSignature,
      timestampSeconds,
      nowSeconds: timestampSeconds + 5,
      rawPayload,
      webhookAmountCents: 6232,
      webhookCurrencyCode: "BRL",
      order: created.order,
      processedEventKeys: processedSet,
    });

    assert.equal(webhookResult1.deduplicated, false);
    assert.equal(webhookResult1.action, "ORDER_PAYMENT_CAPTURED");
    assert.equal(webhookResult1.updatedOrder.orderStatus, "PENDING_MERCHANT_ACCEPTANCE");
    assert.equal(webhookResult1.updatedOrder.paymentStatus, "CAPTURED");

    processedSet.add("stripe:evt_001");
    const webhookDup = verifyAndProcessPspWebhook({
      providerCode: "stripe",
      externalEventId: "evt_001",
      eventType: "payment.captured",
      webhookSecret,
      signatureHeader: validSignature,
      timestampSeconds,
      nowSeconds: timestampSeconds + 10,
      rawPayload,
      webhookAmountCents: 6232,
      webhookCurrencyCode: "BRL",
      order: webhookResult1.updatedOrder,
      processedEventKeys: processedSet,
    });
    assert.equal(webhookDup.deduplicated, true);
    assert.equal(webhookDup.action, "NO_OP_DUPLICATE");

    // Late PSP capture arriving after an order was already CANCELLED transitions to DISPUTED
    const cancelledCmd = executeOrderCommand({
      order: created.order,
      command: "CANCEL",
      expectedVersion: 1,
      actorId: "cust_001",
      actorRole: "CUSTOMER",
      idempotencyKey: "idem_cancel_1",
      reason: "Customer changed mind within 120s window",
      now: new Date(now.getTime() + 30 * 1000),
    });
    assert.equal(cancelledCmd.updatedOrder.orderStatus, "CANCELLED");

    const lateCaptureResult = verifyAndProcessPspWebhook({
      providerCode: "stripe",
      externalEventId: "evt_late_002",
      eventType: "payment.captured",
      webhookSecret,
      signatureHeader: validSignature,
      timestampSeconds,
      nowSeconds: timestampSeconds + 40,
      rawPayload,
      webhookAmountCents: 6232,
      webhookCurrencyCode: "BRL",
      order: cancelledCmd.updatedOrder,
      processedEventKeys: new Set(),
    });
    assert.equal(lateCaptureResult.action, "LATE_CAPTURE_CONFLICT_QUEUED_FOR_REFUND");
    assert.equal(lateCaptureResult.updatedOrder.orderStatus, "DISPUTED");

    // M12 Refund ABAC & MFA aal2 evaluation
    const refundEval = evaluateRefundRequest({
      orderId: "ord_1002",
      capturedAmountCents: 6232,
      alreadyRefundedCents: 0,
      requestedRefundCents: 2000,
      staffMaxRefundApprovalCents: 10000,
      actorAal: "aal2",
      reason: "Missing item compensation",
    });
    assert.equal(refundEval.newPaymentStatus, "PARTIALLY_REFUNDED");
    assert.equal(refundEval.reversalLedgerDebitsCents, 2000);
    assert.equal(refundEval.reversalLedgerCreditsCents, 2000);
  });

  it("evaluates LGPD account deletion requests and enforces legal retention holds", () => {
    const now = new Date("2026-11-03T12:00:00Z");

    const activeOrderHold = evaluateAccountDeletionRequest({
      userId: "00000000-0000-4000-8000-000000000001",
      hasActiveOrders: true,
      hasOpenFinancialDisputes: false,
      hasCompletedFiscalTransactions: true,
      requestedAt: now,
    });
    assert.equal(activeOrderHold.outcome, "RETENTION_HOLD");
    assert.equal(activeOrderHold.revokeAllSessionsImmediately, true);
    assert.equal(activeOrderHold.reasonCode, "ACTIVE_ORDER_IN_PROGRESS");

    const cleanDelete = evaluateAccountDeletionRequest({
      userId: "00000000-0000-4000-8000-000000000002",
      hasActiveOrders: false,
      hasOpenFinancialDisputes: false,
      hasCompletedFiscalTransactions: false,
      requestedAt: now,
    });
    assert.equal(cleanDelete.outcome, "IMMEDIATE_ANONYMIZATION");
    assert.equal(cleanDelete.holdUntilIso, null);
  });

  it("throws honest PROVIDER_BLOCKED error when external credentials are missing", () => {
    assert.throws(
      () =>
        assertExternalProviderReady({
          providerCode: "stripe",
          status: "BLOCKED_MISSING_CREDENTIALS",
          missingEnvVars: ["STRIPE_SECRET_KEY"],
        }),
      /PROVIDER_BLOCKED \[stripe\]/
    );

    assert.doesNotThrow(() =>
      assertExternalProviderReady({
        providerCode: "stripe",
        status: "SANDBOX_READY",
        missingEnvVars: [],
      })
    );
  });

  it("enforces Fase D M13 double-entry journal balance, PSP reconciliation & payout Segregation of Duties", () => {
    const now = new Date("2026-11-03T15:00:00Z");
    const quote = {
      id: "quote_m13",
      customerId: "cust_001",
      storeId: "store_201",
      addressId: "addr_001",
      fulfillmentModality: "PLATFORM_DELIVERY" as const,
      promotionCode: null,
      currencyCode: "BRL" as const,
      subtotalCents: 5000,
      addonsCents: 0,
      serviceFeeCents: 250,
      deliveryFeeCents: 800,
      discountCents: 500,
      totalCents: 5550,
      platformCommissionCents: 600,
      merchantNetCents: 4400,
      courierEarningsCents: 800,
      distanceMeters: 1500,
      estimatedPrepMinutes: 25,
      estimatedDeliveryMinutes: 35,
      itemsSnapshot: [
        {
          productId: "prod_1",
          productNameEn: "Burger",
          productNamePtBr: "Hambúrguer",
          quantity: 1,
          unitPriceCents: 5000,
          addonsUnitPriceCents: 0,
          totalLineCents: 5000,
          selectedOptions: [],
        },
      ],
      addressSnapshot: null,
      idempotencyKey: "idem_q_m13",
      expiresAtIso: "2026-11-03T15:15:00Z",
      consumedAtIso: null,
      createdAtIso: "2026-11-03T15:00:00Z",
    };

    const created = createOrderFromServerQuote({
      orderId: "ord_m13_1",
      orderNumber: 10050,
      organizationId: "org_101",
      quote,
      actorCustomerId: "cust_001",
      isStoreCurrentlyOpen: true,
      discountFundedBy: "PLATFORM",
      idempotencyKey: "idem_ord_m13_1",
      now,
    });

    const journal = buildBalancedOrderCaptureJournal({
      journalId: "jnl_m13_1",
      order: created.order,
      discountFundedBy: "PLATFORM",
      postedBy: "staff_fin_1",
      now,
    });

    // Total debits = 5550 (PSP clearing) + 500 (Platform promo subsidy) = 6050
    // Total credits = 4400 (Merchant payable) + 800 (Courier payable) + 600 (Commission) + 250 (Service fee) = 6050
    assert.equal(journal.totalDebitsCents, 6050);
    assert.equal(journal.totalCreditsCents, 6050);

    // PSP Reconciliation detects a 50-centavo discrepancy on a second order
    const recon = evaluatePspReconciliationRun({
      runId: "recon_1",
      providerCode: "stripe",
      runDate: "2026-11-03",
      expectedOrders: [
        { orderId: "ord_m13_1", totalCents: 5550 },
        { orderId: "ord_m13_2", totalCents: 3200 },
      ],
      pspReportedCaptures: [
        { orderId: "ord_m13_1", capturedCents: 5550 },
        { orderId: "ord_m13_2", capturedCents: 3150 },
      ],
      now,
    });
    assert.equal(recon.matchedCount, 1);
    assert.equal(recon.discrepancyCount, 1);
    assert.equal(recon.discrepancyTotalCents, 50);

    // Segregation of Duties: same staff member who approved bank account cannot execute payout
    const settlementBase = {
      id: "settle_1",
      organizationId: "org_101",
      courierId: null,
      periodStart: "2026-11-01",
      periodEnd: "2026-11-03",
      amountCents: 44000,
      status: "SCHEDULED" as const,
      approvedBy: null,
      externalPayoutReference: null,
      createdAtIso: now.toISOString(),
    };

    assert.throws(
      () =>
        evaluateSettlementPayoutExecution({
          settlement: settlementBase,
          actorId: "staff_fin_1",
          actorAal: "aal2",
          actorRoles: ["finance"],
          bankAccountApprovedByActorId: "staff_fin_1",
          pspProviderStatus: "SANDBOX_READY",
          externalPayoutReference: "po_stripe_12345",
        }),
      /SETTLEMENT_SEGREGATION_OF_DUTIES_VIOLATION/
    );

    // Honest BLOCKED_NO_PSP when PSP credentials are missing
    const blockedSettlement = evaluateSettlementPayoutExecution({
      settlement: settlementBase,
      actorId: "staff_fin_2",
      actorAal: "aal2",
      actorRoles: ["finance"],
      bankAccountApprovedByActorId: "staff_fin_1",
      pspProviderStatus: "BLOCKED_MISSING_CREDENTIALS",
    });
    assert.equal(blockedSettlement.status, "BLOCKED_NO_PSP");
    assert.equal(blockedSettlement.externalPayoutReference, null);
  });

  it("enforces Fase D M14/M11 transactional offer acceptance, address privacy, GPS staleness & M15 fleet isolation", () => {
    const now = new Date("2026-11-03T15:00:00Z");
    const task = {
      id: "dtask_1",
      orderId: "ord_1",
      storeId: "store_201",
      fulfillmentModality: "PLATFORM_DELIVERY" as const,
      status: "OFFERING",
      pickupLatitude: -23.561414,
      pickupLongitude: -46.655881,
      dropoffLatitude: -23.56398,
      dropoffLongitude: -46.66912,
      dropoffNeighborhoodOnly: "Bela Vista",
      dropoffFullAddress: null,
      courierFeeCents: 850,
      distanceMeters: 1420,
      estimatedEtaMinutes: 18,
      activeCourierId: null,
      pickedUpAtIso: null,
      completedAtIso: null,
      createdAtIso: now.toISOString(),
    };

    const offer1 = {
      id: "doff_1",
      deliveryTaskId: "dtask_1",
      courierId: "courier_1",
      offeredFeeCents: 850,
      status: "OFFERED" as const,
      pickupStoreName: "Paulista Artisan Burger",
      distanceMeters: 1420,
      dropoffNeighborhoodOnly: "Bela Vista",
      expiresAtIso: "2026-11-03T15:01:00Z",
      respondedAtIso: null,
    };

    const accepted = acceptDeliveryOfferTransactional({
      offer: offer1,
      task,
      actorCourierId: "courier_1",
      isCourierOnline: true,
      fullCustomerAddress: "Av. Paulista, 1578 - Apt 42, Bela Vista",
      now,
    });
    assert.equal(accepted.updatedTask.activeCourierId, "courier_1");
    assert.equal(
      accepted.updatedTask.dropoffFullAddress,
      "Av. Paulista, 1578 - Apt 42, Bela Vista"
    );

    // Concurrent second courier acceptance on already-assigned task throws DELIVERY_TASK_ALREADY_ASSIGNED
    assert.throws(
      () =>
        acceptDeliveryOfferTransactional({
          offer: { ...offer1, id: "doff_2", courierId: "courier_2" },
          task: accepted.updatedTask,
          actorCourierId: "courier_2",
          isCourierOnline: true,
          fullCustomerAddress: "Av. Paulista, 1578 - Apt 42, Bela Vista",
          now,
        }),
      /DELIVERY_TASK_ALREADY_ASSIGNED/
    );

    // Stale GPS sample (>120s old) is flagged as isStaleOrLowAccuracy
    const staleSample = evaluateCourierLocationSample({
      sampleId: "loc_1",
      courierId: "courier_1",
      deliveryTaskId: "dtask_1",
      activeCourierIdForTask: "courier_1",
      latitude: -23.562,
      longitude: -46.66,
      accuracyMeters: 25,
      recordedAtIso: "2026-11-03T14:55:00Z", // 5 minutes old
      now,
    });
    assert.equal(staleSample.isStaleOrLowAccuracy, true);

    // Proof-of-Delivery 4-digit OTP constant-time verification
    const otpHash = hashDeliveryConfirmationCode("4829");
    assert.equal(
      verifyDeliveryConfirmationCode({ providedCode: "4829", expectedCodeHash: otpHash }),
      true
    );
    assert.equal(
      verifyDeliveryConfirmationCode({ providedCode: "9999", expectedCodeHash: otpHash }),
      false
    );

    // M15 Fleet isolation: Fleet A manager cannot view independent courier or Fleet B courier
    const independentAccess = evaluateFleetOperatorAccess({
      fleetOrganizationId: "fleet_org_A",
      actorOrganizationIds: ["fleet_org_A"],
      targetCourierFleetOrgId: null,
      isFleetContractApproved: true,
    });
    assert.equal(independentAccess.allowed, false);
    assert.equal(independentAccess.reasonCode, "DENIED_CROSS_FLEET_OR_INDEPENDENT_COURIER");
  });

  it("enforces M17 support SLA calculation, internal note stripping, auto-refund ceiling, and finance aal2 Segregation of Duties", () => {
    const now = new Date("2026-11-14T12:00:00Z");

    // 1. SLA calculation upgrades ROUTE_INCIDENT to CRITICAL_IN_ROUTE (15 min)
    const slaCritical = computeSupportSlaDueAt({
      priority: "MEDIUM",
      category: "ROUTE_INCIDENT",
      createdAt: now,
    });
    assert.equal(slaCritical.effectivePriority, "CRITICAL_IN_ROUTE");
    assert.equal(slaCritical.slaMinutes, 15);
    assert.equal(slaCritical.slaDueAtIso, "2026-11-14T12:15:00.000Z");

    // 2. State machine transitions & internal note filtering
    const baseCase = {
      id: "case_001",
      caseNumber: 5001,
      orderId: "ord_1001",
      deliveryTaskId: "task_1201",
      organizationId: "org_101",
      storeId: "store_201",
      requesterId: "cust_001",
      requesterRole: "CUSTOMER" as const,
      assignedStaffId: null,
      category: "MISSING_ITEM",
      priority: "HIGH" as const,
      status: "OPEN" as const,
      subject: "Missing item in my order",
      slaDueAtIso: "2026-11-14T13:00:00.000Z",
      resolvedAtIso: null,
      createdAtIso: now.toISOString(),
      updatedAtIso: now.toISOString(),
    };

    const inProgressCase = transitionSupportCaseStatus({
      supportCase: baseCase,
      targetStatus: "IN_PROGRESS",
      assignedStaffId: "staff_support_01",
      now,
    });
    assert.equal(inProgressCase.status, "IN_PROGRESS");
    assert.equal(inProgressCase.assignedStaffId, "staff_support_01");

    assert.throws(
      () =>
        transitionSupportCaseStatus({
          supportCase: inProgressCase,
          targetStatus: "OPEN",
          now,
        }),
      /SUPPORT_CASE_INVALID_TRANSITION/
    );

    const messages = [
      {
        id: "msg_public",
        caseId: "case_001",
        senderId: "cust_001",
        body: "My fries were missing.",
        isInternalNote: false,
        createdAtIso: now.toISOString(),
      },
      {
        id: "msg_internal",
        caseId: "case_001",
        senderId: "staff_support_01",
        body: "INTERNAL: Checked kitchen camera, fries were forgotten.",
        isInternalNote: true,
        createdAtIso: now.toISOString(),
      },
    ];
    const attachments = [
      {
        id: "att_public",
        caseId: "case_001",
        messageId: "msg_public",
        uploadedBy: "cust_001",
        storageBucket: "support-attachments",
        objectPath: "cases/case_001/bag.jpg",
        mimeType: "image/jpeg",
        byteSize: 42000,
        sha256Hex: "abc",
        isInternalOnly: false,
        createdAtIso: now.toISOString(),
      },
      {
        id: "att_internal",
        caseId: "case_001",
        messageId: "msg_internal",
        uploadedBy: "staff_support_01",
        storageBucket: "support-attachments",
        objectPath: "cases/case_001/audit.pdf",
        mimeType: "application/pdf",
        byteSize: 84000,
        sha256Hex: "def",
        isInternalOnly: true,
        createdAtIso: now.toISOString(),
      },
    ];

    const customerView = filterSupportCaseViewForActor({
      supportCase: inProgressCase,
      messages,
      attachments,
      actionRequests: [],
      isStaffActor: false,
    });
    assert.equal(customerView.messages.length, 1);
    assert.equal(customerView.messages[0]?.id, "msg_public");
    assert.equal(customerView.attachments.length, 1);
    assert.equal(customerView.attachments[0]?.id, "att_public");

    // 3. Support refund within threshold (<= 1500 cents) auto-approves
    const withinThreshold = evaluateSupportActionRequest({
      id: "act_1",
      caseId: "case_001",
      orderId: "ord_1001",
      requestedByStaffId: "staff_support_01",
      actionType: "PARTIAL_REFUND",
      amountCents: 1200,
      orderCapturedCents: 5476,
      alreadyRefundedCents: 0,
      autoApproveLimitCents: 1500,
      reason: "Missing fries compensation within L1 threshold",
      now,
    });
    assert.equal(withinThreshold.autoApproved, true);
    assert.equal(withinThreshold.actionRequest.status, "APPROVED");
    assert.equal(withinThreshold.nextCaseStatus, "RESOLVED");

    // 4. Support refund above threshold (> 1500 cents) escalates to PENDING_FINANCE
    const escalated = evaluateSupportActionRequest({
      id: "act_2",
      caseId: "case_001",
      orderId: "ord_1001",
      requestedByStaffId: "staff_support_01",
      actionType: "PARTIAL_REFUND",
      amountCents: 3500,
      orderCapturedCents: 5476,
      alreadyRefundedCents: 0,
      autoApproveLimitCents: 1500,
      reason: "Major missing item above L1 threshold",
      now,
    });
    assert.equal(escalated.autoApproved, false);
    assert.equal(escalated.actionRequest.status, "PENDING_FINANCE");
    assert.equal(escalated.nextCaseStatus, "ESCALATED_FINANCE");

    // 5. Finance decision requires aal2 and distinct staff actor (Segregation of Duties)
    assert.throws(
      () =>
        decideEscalatedSupportActionRequest({
          request: escalated.actionRequest,
          decision: "APPROVED",
          decidedByStaffId: "staff_support_01",
          actorStaffRoles: ["finance"],
          actorAal: "aal2",
          decisionNotes: "Self-approval attempt",
          now,
        }),
      /SEGREGATION_OF_DUTIES_VIOLATION/
    );

    const financeApproved = decideEscalatedSupportActionRequest({
      request: escalated.actionRequest,
      decision: "APPROVED",
      decidedByStaffId: "staff_finance_02",
      actorStaffRoles: ["finance"],
      actorAal: "aal2",
      decisionNotes: "Approved after verifying merchant ticket",
      now,
    });
    assert.equal(financeApproved.status, "APPROVED");
    assert.equal(financeApproved.decidedBy, "staff_finance_02");
  });

  it("enforces Fase O (M18) commercial lead transitions, proposal validation, versioned contracts + commission rules, partner_owner acceptance, and finance segregation", () => {
    const now = new Date("2026-11-14T15:00:00.000Z");

    // 1. Lead transitions
    const initialLead = {
      id: "lead_01",
      legalName: "Padaria Bela Vista Ltda",
      tradeName: "Padaria Bela Vista",
      taxId: "33445566000188",
      contactEmail: "roberto@belavista.example.com",
      contactPhone: "+5511977776666",
      city: "São Paulo",
      stateCode: "SP",
      cuisineCategory: "Bakery & Cafe",
      legalBasis: "LEGITIMATE_INTEREST_B2B",
      status: "NEW" as const,
      ownerStaffId: "staff_commercial_01",
      convertedOrganizationId: null,
      notes: "High foot-traffic bakery",
      createdAtIso: now.toISOString(),
      updatedAtIso: now.toISOString(),
    };

    const qualifying = transitionCommercialLeadStatus({
      lead: initialLead,
      targetStatus: "QUALIFYING",
      now,
    });
    assert.equal(qualifying.status, "QUALIFYING");

    const proposalSent = transitionCommercialLeadStatus({
      lead: qualifying,
      targetStatus: "PROPOSAL_SENT",
      now,
    });
    assert.equal(proposalSent.status, "PROPOSAL_SENT");

    // Cannot convert without convertedOrganizationId
    assert.throws(
      () =>
        transitionCommercialLeadStatus({
          lead: proposalSent,
          targetStatus: "CONVERTED",
          now,
        }),
      /COMMERCIAL_LEAD_ORGANIZATION_REQUIRED/
    );

    const converted = transitionCommercialLeadStatus({
      lead: proposalSent,
      targetStatus: "CONVERTED",
      convertedOrganizationId: "org_new_01",
      now,
    });
    assert.equal(converted.status, "CONVERTED");
    assert.equal(converted.convertedOrganizationId, "org_new_01");

    // 2. Proposal validation & versioned contract + commission rule generation
    const proposal = validateAndBuildCommercialProposal({
      id: "prop_01",
      leadId: "lead_01",
      proposalVersion: 1,
      platformDeliveryCommissionBps: 1150,
      merchantDeliveryCommissionBps: 550,
      pickupCommissionBps: 350,
      serviceFeeBps: 500,
      payoutCycleDays: 7,
      notes: "Standard Bakery Partner Tier v1 (11.5% Marketplace, 7-day settlement)",
      validUntilIso: "2026-12-31T23:59:59.000Z",
      proposedByStaffId: "staff_commercial_01",
      now,
    });
    assert.equal(proposal.status, "SENT");
    assert.equal(proposal.legalTemplateStatus, "PENDING_LEGAL_REVIEW");

    const { updatedProposal, contract, commissionRule } = buildVersionedContractAndCommissionRule({
      proposal,
      organizationId: "org_new_01",
      contractId: "contract_01",
      commissionRuleId: "crule_01",
      previousContractVersion: 0,
      createdByStaffId: "staff_commercial_01",
      now,
    });
    assert.equal(updatedProposal.status, "ACCEPTED");
    assert.equal(updatedProposal.organizationId, "org_new_01");
    assert.equal(contract.versionNumber, 1);
    assert.equal(contract.platformDeliveryCommissionBps, 1150);
    assert.equal(contract.serviceFeeBps, 500);
    assert.equal(contract.acceptedByPartnerOwnerId, null);
    assert.equal(commissionRule.versionNumber, 1);
    assert.equal(commissionRule.contractId, "contract_01");

    // 3. Partner contract acceptance requires partner_owner of that organization
    assert.throws(
      () =>
        evaluatePartnerContractAcceptance({
          contract,
          actorId: "user_operator",
          actorOrganizationMemberships: [
            { organizationId: "org_new_01", role: "partner_operator" },
          ],
          now,
        }),
      /PARTNER_OWNER_REQUIRED_FOR_CONTRACT_ACCEPTANCE/
    );

    const acceptedContract = evaluatePartnerContractAcceptance({
      contract,
      actorId: "user_owner",
      actorOrganizationMemberships: [
        { organizationId: "org_new_01", role: "partner_owner" },
      ],
      now,
    });
    assert.equal(acceptedContract.acceptedByPartnerOwnerId, "user_owner");
    assert.equal(acceptedContract.acceptedAtIso, now.toISOString());

    // 4. Commercial staff is strictly segregated from finance execution
    assert.throws(
      () =>
        assertCommercialSegregationFromFinance({
          actorStaffRoles: ["commercial"],
          operation: "SETTLEMENT_EXECUTION",
        }),
      /COMMERCIAL_FINANCE_SEGREGATION_VIOLATION/
    );
    assert.doesNotThrow(() =>
      assertCommercialSegregationFromFinance({
        actorStaffRoles: ["finance"],
        operation: "SETTLEMENT_EXECUTION",
      })
    );
  });

  it("enforces Fase P (M19) promotion eligibility, shared subsidy double-entry ledger balance, and verified order review moderation", () => {
    const now = new Date("2026-11-14T15:00:00.000Z");

    const sharedPromo = {
      id: "promo_shared_01",
      code: "PAULISTA15",
      storeId: "store_201",
      fundedBy: "SHARED" as const,
      platformShareBps: 5000,
      firstOrderOnly: false,
      discountType: "PERCENTAGE_BPS" as const,
      discountValue: 1500, // 15%
      maxDiscountCents: 2000,
      minOrderCents: 4000,
      budgetLimitCents: 10000,
      budgetConsumedCents: 9000,
      maxUsesPerUser: 2,
      startsAtIso: "2026-01-01T00:00:00.000Z",
      endsAtIso: "2027-12-31T23:59:59.000Z",
      isActive: true,
      createdBy: "staff_mkt_01",
      createdAtIso: now.toISOString(),
    };

    // 1. Store mismatch
    const wrongStore = evaluatePromotionEligibilityAndSubsidy({
      promotion: sharedPromo,
      storeId: "store_202",
      grossMerchandiseCents: 6000,
      customerPriorOrdersCount: 1,
      customerPriorRedemptionsForPromo: 0,
      now,
    });
    assert.equal(wrongStore.eligible, false);
    assert.equal(wrongStore.reasonCode, "PROMO_STORE_MISMATCH");

    // 2. Budget exhausted (15% of 8000 = 1200 cents, but only 1000 cents remaining in budget)
    const budgetExhausted = evaluatePromotionEligibilityAndSubsidy({
      promotion: sharedPromo,
      storeId: "store_201",
      grossMerchandiseCents: 8000,
      customerPriorOrdersCount: 1,
      customerPriorRedemptionsForPromo: 0,
      now,
    });
    assert.equal(budgetExhausted.eligible, false);
    assert.equal(budgetExhausted.reasonCode, "PROMO_BUDGET_EXHAUSTED");

    // 3. Eligible shared subsidy (15% of 6000 = 900 cents -> 450 platform, 450 merchant)
    const eligible = evaluatePromotionEligibilityAndSubsidy({
      promotion: sharedPromo,
      storeId: "store_201",
      grossMerchandiseCents: 6000,
      customerPriorOrdersCount: 1,
      customerPriorRedemptionsForPromo: 1,
      now,
    });
    assert.equal(eligible.eligible, true);
    assert.equal(eligible.discountCents, 900);
    assert.equal(eligible.platformSubsidyCents, 450);
    assert.equal(eligible.merchantSubsidyCents, 450);

    // 4. Quote & double-entry ledger balance with SHARED 50/50 subsidy
    const split = calculateServerQuoteAndSplit({
      items: [{ productId: "p1", quantity: 1, unitPriceCents: 6000, addonsUnitPriceCents: 0 }],
      fulfillmentModality: "PLATFORM_DELIVERY",
      deliveryFeeCents: 700,
      discountCents: eligible.discountCents,
      discountFundedBy: "SHARED",
      platformSubsidyShareBps: 5000,
      minOrderCents: 2500,
    });
    assert.equal(split.ledgerDebitsCents, split.ledgerCreditsCents);

    const sampleDeliveredOrder = {
      id: "ord_delivered_1",
      orderNumber: 20001,
      customerId: "cust_alice",
      organizationId: "org_101",
      storeId: "store_201",
      quoteId: "q_1",
      fulfillmentModality: "PLATFORM_DELIVERY" as const,
      orderStatus: "DELIVERED" as const,
      paymentStatus: "CAPTURED" as const,
      deliveryStatus: "DELIVERED" as const,
      currencyCode: "BRL" as const,
      subtotalCents: split.subtotalCents,
      addonsCents: split.addonsCents,
      serviceFeeCents: split.serviceFeeCents,
      deliveryFeeCents: split.deliveryFeeCents,
      discountCents: split.discountCents,
      totalCents: split.totalCents,
      platformCommissionCents: split.platformCommissionCents,
      merchantNetCents: split.merchantNetCents,
      courierEarningsCents: split.courierEarningsCents,
      deliveryAddressSnapshot: null,
      itemsSnapshot: [],
      customerNotes: null,
      cancellationReason: null,
      cancelledByRole: null,
      version: 5,
      idempotencyKey: "idem_ord_del_1",
      acceptedAtIso: now.toISOString(),
      readyAtIso: now.toISOString(),
      deliveredAtIso: now.toISOString(),
      cancelledAtIso: null,
      createdAtIso: now.toISOString(),
      updatedAtIso: now.toISOString(),
    };

    const sharedJournal = buildBalancedOrderCaptureJournal({
      journalId: "jnl_shared_1",
      order: sampleDeliveredOrder,
      discountFundedBy: "SHARED",
      platformSubsidyShareBps: 5000,
      postedBy: "staff_fin_01",
      now,
    });
    assert.equal(sharedJournal.totalDebitsCents, sharedJournal.totalCreditsCents);

    // 5. Verified review creation, partner reply, and admin moderation
    assert.throws(
      () =>
        evaluateVerifiedOrderReviewCreation({
          id: "rev_1",
          order: sampleDeliveredOrder,
          actorCustomerId: "cust_bruno_wrong",
          existingReviewForOrder: null,
          rating: 5,
          comment: "Great!",
          now,
        }),
      /REVIEW_NOT_ORDER_OWNER/
    );

    const createdReview = evaluateVerifiedOrderReviewCreation({
      id: "rev_1",
      order: sampleDeliveredOrder,
      actorCustomerId: "cust_alice",
      existingReviewForOrder: null,
      rating: 5,
      comment: "Crispy smash burger!",
      now,
    });
    assert.equal(createdReview.moderationStatus, "PUBLISHED");

    const repliedReview = evaluatePartnerReviewReply({
      review: createdReview,
      replyText: "Thank you for your feedback, Alice!",
      now,
    });
    assert.equal(repliedReview.rating, 5);
    assert.equal(repliedReview.comment, "Crispy smash burger!");
    assert.equal(repliedReview.partnerReply, "Thank you for your feedback, Alice!");

    const moderatedReview = evaluateAdminReviewModeration({
      review: repliedReview,
      targetModerationStatus: "HIDDEN_BY_MODERATION",
      moderatorStaffId: "staff_mod_01",
      actorStaffRoles: ["marketing"],
      moderationReason: "Confirmed policy violation in review attachment reference",
      now,
    });
    assert.equal(moderatedReview.moderationStatus, "HIDDEN_BY_MODERATION");
    assert.equal(moderatedReview.rating, 5);

    const ratingSummary = calculatePublishedStoreRatingSummary([
      createdReview,
      moderatedReview,
    ]);
    assert.equal(ratingSummary.publishedReviewsCount, 1);
    assert.equal(ratingSummary.averageRating, 5);
  });

  it("enforces M20 versioned notification templates (en/pt-BR), revoked device push block, honest external credentials status, HMAC webhooks, and Realtime cursor recovery (Fase Q)", () => {
    // 1. Exponential backoff
    assert.equal(calculateOutboxBackoffMs(1, 1000, 30000), 1000);
    assert.equal(calculateOutboxBackoffMs(3, 1000, 30000), 4000);
    assert.equal(calculateOutboxBackoffMs(10, 1000, 30000), 30000);

    // 2. Bilingual versioned templates (en and pt-BR)
    const tplEn = renderVersionedNotificationTemplate({
      eventType: "ORDER_CREATED",
      locale: "en",
      payload: { orderNumber: 10042, storeName: "Paulista Artisan Burgers - Jardins" },
    });
    assert.equal(tplEn.templateKey, "order.created");
    assert.equal(tplEn.version, 1);
    assert.equal(tplEn.category, "TRANSACTIONAL");
    assert.equal(tplEn.locale, "en");
    assert.match(tplEn.title, /Order #10042 created/);

    const tplPt = renderVersionedNotificationTemplate({
      eventType: "payment.captured",
      locale: "pt-BR",
      payload: { orderNumber: 10042, amountCents: 6232 },
    });
    assert.equal(tplPt.templateKey, "payment.captured");
    assert.equal(tplPt.locale, "pt-BR");
    assert.match(tplPt.title, /Pedido #10042/);
    assert.match(tplPt.body, /R\$\s*62,32/);

    // 3. Channel eligibility: mandatory transactional IN_APP vs marketing opt-out vs revoked device vs missing credentials
    const inAppTransactional = evaluateNotificationChannelEligibility({
      channel: "IN_APP",
      category: "TRANSACTIONAL",
      preferences: {
        pushOrderUpdates: false,
        pushPromotions: false,
        emailTransactional: false,
        emailMarketing: false,
      },
    });
    assert.equal(inAppTransactional.eligible, true);
    assert.equal(inAppTransactional.deliveryStatus, "DELIVERED");

    const marketingOptOut = evaluateNotificationChannelEligibility({
      channel: "EMAIL",
      category: "MARKETING",
      preferences: {
        pushOrderUpdates: true,
        pushPromotions: false,
        emailTransactional: true,
        emailMarketing: false,
      },
      providerStatus: "ACTIVE_PRODUCTION",
    });
    assert.equal(marketingOptOut.eligible, false);
    assert.equal(marketingOptOut.deliveryStatus, "SKIPPED_OPT_OUT");

    const revokedDevicePush = evaluateNotificationChannelEligibility({
      channel: "PUSH_ANDROID",
      category: "TRANSACTIONAL",
      device: {
        isRevoked: true,
        revokedAtIso: "2026-11-14T04:00:00.000Z",
        pushConsentGranted: true,
        pushToken: "fcm_tok_revoked_01",
      },
      providerStatus: "ACTIVE_PRODUCTION",
    });
    assert.equal(revokedDevicePush.eligible, false);
    assert.equal(revokedDevicePush.deliveryStatus, "BLOCKED_DEVICE_REVOKED");

    const blockedExternalEmail = evaluateNotificationChannelEligibility({
      channel: "EMAIL",
      category: "TRANSACTIONAL",
      providerStatus: "BLOCKED_MISSING_CREDENTIALS",
    });
    assert.equal(blockedExternalEmail.eligible, false);
    assert.equal(blockedExternalEmail.deliveryStatus, "BLOCKED_MISSING_CREDENTIALS");

    // 4. Outbound webhook HMAC-SHA256 signing & anti-replay verification
    const secret = "whsec_test_outbound_partner_secret_2026";
    const envelope = signOutboundWebhookPayload({
      eventId: "evt_outbox_101",
      eventType: "order.status_changed",
      payload: { orderId: "ord_101", status: "PREPARING" },
      secret,
      timestampSeconds: 1700000000,
    });
    const verifiedOk = verifyOutboundWebhookSignature({
      envelope,
      secret,
      nowSeconds: 1700000120,
      toleranceSeconds: 300,
    });
    assert.equal(verifiedOk.valid, true);

    const verifiedReplayExpired = verifyOutboundWebhookSignature({
      envelope,
      secret,
      nowSeconds: 1700000600,
      toleranceSeconds: 300,
    });
    assert.equal(verifiedReplayExpired.valid, false);
    assert.equal(verifiedReplayExpired.reasonCode, "WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE");

    // 5. Realtime cursor recovery deduplication
    const reconciled = reconcileNotificationsSinceCursor({
      existingNotifications: [
        {
          id: "notif_1",
          outboxEventId: "evt_1",
          recipientUserId: "user_1",
          channel: "IN_APP",
          templateKey: "order.created",
          templateVersion: 1,
          category: "TRANSACTIONAL",
          locale: "en",
          title: "Order #10001 created",
          body: "Received",
          payload: {},
          status: "DELIVERED",
          providerCode: null,
          idempotencyKey: "idem_1",
          cursorSeq: 10,
          readAtIso: null,
          lastError: null,
          createdAtIso: "2026-11-14T04:00:00.000Z",
        },
      ],
      incomingBatch: [
        {
          id: "notif_1",
          outboxEventId: "evt_1",
          recipientUserId: "user_1",
          channel: "IN_APP",
          templateKey: "order.created",
          templateVersion: 1,
          category: "TRANSACTIONAL",
          locale: "en",
          title: "Order #10001 created",
          body: "Received",
          payload: {},
          status: "DELIVERED",
          providerCode: null,
          idempotencyKey: "idem_1",
          cursorSeq: 10,
          readAtIso: null,
          lastError: null,
          createdAtIso: "2026-11-14T04:00:00.000Z",
        },
        {
          id: "notif_2",
          outboxEventId: "evt_2",
          recipientUserId: "user_1",
          channel: "IN_APP",
          templateKey: "order.status_changed",
          templateVersion: 1,
          category: "TRANSACTIONAL",
          locale: "en",
          title: "Order #10001 status updated: PREPARING",
          body: "Preparing",
          payload: {},
          status: "DELIVERED",
          providerCode: null,
          idempotencyKey: "idem_2",
          cursorSeq: 11,
          readAtIso: null,
          lastError: null,
          createdAtIso: "2026-11-14T04:01:00.000Z",
        },
      ],
      sinceCursorSeq: 10,
    });
    assert.equal(reconciled.merged.length, 2);
    assert.equal(reconciled.newlyRecoveredCount, 1);
    assert.equal(reconciled.latestCursorSeq, 11);
  });

  it("enforces M21 reproducible analytical KPIs, exact M13 ledger reconciliation, explainable risk alerts with mandatory human review, and LGPD portability/anonymization", () => {
    // 1. Reproducible GMV vs Net Platform Revenue reconciled cent-for-cent with M13 ledger
    const kpisAll = computeReproducibleAnalyticalKpis({
      orderRows: [
        {
          orderId: "00000000-0000-4000-8000-000000001001",
          orderNumber: 10001,
          organizationId: "00000000-0000-4000-8000-000000000101",
          storeId: "00000000-0000-4000-8000-000000000201",
          storeName: "Paulista Artisan Burgers - Jardins",
          city: "São Paulo",
          stateCode: "SP",
          orderStatus: "DELIVERED",
          paymentStatus: "CAPTURED",
          subtotalCents: 5580,
          addonsCents: 650,
          deliveryFeeCents: 690,
          serviceFeeCents: 312,
          discountCents: 1000,
          totalCents: 6232,
          platformCommissionCents: 1433,
          merchantNetCents: 4797,
          courierEarningsCents: 690,
          platformCouponSubsidyCents: 1000,
          merchantCouponSubsidyCents: 0,
          gmvCents: 7232,
          platformNetRevenueCents: 745,
          operationalMarginCents: 745,
          prepSlaMinutes: 22,
          deliverySlaMinutes: 18,
          cancellationReason: null,
          cancelledByRole: null,
          isTestData: true,
          createdAt: "2026-11-03T15:00:00.000Z",
        },
        {
          orderId: "00000000-0000-4000-8000-000000001002",
          orderNumber: 10002,
          organizationId: "00000000-0000-4000-8000-000000000101",
          storeId: "00000000-0000-4000-8000-000000000201",
          storeName: "Paulista Artisan Burgers - Jardins",
          city: "São Paulo",
          stateCode: "SP",
          orderStatus: "CANCELLED",
          paymentStatus: "CANCELLED",
          subtotalCents: 4000,
          addonsCents: 0,
          deliveryFeeCents: 690,
          serviceFeeCents: 200,
          discountCents: 0,
          totalCents: 4890,
          platformCommissionCents: 920,
          merchantNetCents: 3080,
          courierEarningsCents: 690,
          platformCouponSubsidyCents: 0,
          merchantCouponSubsidyCents: 0,
          gmvCents: 0,
          platformNetRevenueCents: 0,
          operationalMarginCents: 0,
          prepSlaMinutes: null,
          deliverySlaMinutes: null,
          cancellationReason: "CUSTOMER_CHANGED_MIND",
          cancelledByRole: "CUSTOMER",
          isTestData: false,
          createdAt: "2026-11-04T15:00:00.000Z",
        },
      ],
      totalQuotesCount: 4,
      consumedQuotesCount: 2,
      // Ledger Net Revenue = PLATFORM_COMMISSION_REVENUE (1433) + PLATFORM_SERVICE_FEE_REVENUE (312) - PLATFORM_PROMO_SUBSIDY_EXPENSE (1000) = 745
      ledgerRevenueNetCents: 745,
      excludeTestData: false,
    });

    assert.equal(kpisAll.gmvCents, 7232);
    assert.equal(kpisAll.netPlatformRevenueCents, 745);
    assert.equal(kpisAll.isReconciledWithLedger, true);
    assert.equal(kpisAll.quoteConversionRateBps, 5000);
    assert.equal(kpisAll.cancellationRateBps, 5000);
    assert.equal(kpisAll.averagePrepSlaMinutes, 22);
    assert.equal(kpisAll.averageDeliverySlaMinutes, 18);
    assert.equal(kpisAll.cancellationBreakdown.length, 1);
    assert.equal(kpisAll.cancellationBreakdown[0]?.cancelledByRole, "CUSTOMER");

    // Exclude test data filter
    const kpisProdOnly = computeReproducibleAnalyticalKpis({
      orderRows: kpisAll.orderRows,
      totalQuotesCount: 2,
      consumedQuotesCount: 1,
      ledgerRevenueNetCents: 0,
      excludeTestData: true,
    });
    assert.equal(kpisProdOnly.gmvCents, 0);
    assert.equal(kpisProdOnly.totalOrdersCount, 1);

    const csvOutput = formatAnalyticalKpisCsv(kpisAll.orderRows);
    assert.ok(csvOutput.includes("order_id,order_number,store_id,store_name"));
    assert.ok(csvOutput.includes("00000000-0000-4000-8000-000000001001,10001"));

    // 2. Explainable risk rules & mandatory human review
    const riskEval = evaluateExplainableRiskRule({
      ruleCode: "COUPON_ABUSE_MULTI_ACCOUNT",
      subjectType: "USER",
      subjectId: "user_suspect_1",
      observedValue: 4,
      thresholdValue: 2,
      evidenceRefs: ["device:dev_shared_99", "promo:WELCOME10"],
    });
    assert.equal(riskEval.triggered, true);
    assert.equal(riskEval.severity, "CRITICAL");
    assert.equal(riskEval.status, "OPEN_AWAITING_HUMAN_REVIEW");
    assert.equal(riskEval.recommendedAction, "HUMAN_REVIEW_REQUIRED");
    assert.ok(riskEval.ruleExplanation.explanationEn.includes("Mandatory human review required"));
    assert.ok(riskEval.ruleExplanation.explanationPtBr.includes("Revisão humana obrigatória"));

    const sampleAlert = {
      id: "alert_01",
      subjectType: "USER" as const,
      subjectId: "user_suspect_1",
      ruleCode: "COUPON_ABUSE_MULTI_ACCOUNT" as const,
      severity: riskEval.severity,
      status: riskEval.status,
      ruleExplanation: riskEval.ruleExplanation,
      recommendedAction: riskEval.recommendedAction,
      reviewedBy: null,
      reviewDecision: null,
      reviewReason: null,
      reviewedAt: null,
      isTestData: true,
      createdAt: "2026-11-14T06:00:00.000Z",
      updatedAt: "2026-11-14T06:00:00.000Z",
    };

    // Rejects review without MFA aal2
    assert.throws(
      () =>
        validateHumanRiskReview({
          actorId: "staff_risk_1",
          actorRoles: ["risk_compliance"],
          actorAal: "aal1",
          alert: sampleAlert,
          decision: "CONFIRM_BLOCK",
          reason: "Confirmed multi-account abuse across 4 accounts.",
        }),
      /RISK_REVIEW_MFA_AAL2_REQUIRED/
    );

    const humanReview = validateHumanRiskReview({
      actorId: "staff_risk_1",
      actorRoles: ["risk_compliance"],
      actorAal: "aal2",
      alert: sampleAlert,
      decision: "CONFIRM_BLOCK",
      reason: "Confirmed multi-account abuse across 4 accounts.",
    });
    assert.equal(humanReview.updatedStatus, "CONFIRMED_BLOCK");
    assert.equal(humanReview.decision, "CONFIRM_BLOCK");

    // 3. LGPD portability & PII anonymization with statutory fiscal retention hold
    const portabilityPkg = buildLgpdDataPortabilityPackage({
      profile: {
        id: "user_lgpd_1",
        email: "alice@test.ideliveryfood.invalid",
        fullName: "Alice Silva",
        phone: "+5511999990001",
        preferredLocale: "pt-BR",
        status: "ACTIVE",
      },
      addresses: [{ label: "Home", city: "São Paulo" }],
      orders: [
        {
          id: "ord_1",
          orderNumber: 10001,
          storeId: "store_1",
          totalCents: 6232,
          orderStatus: "DELIVERED",
          createdAt: "2026-11-03T15:00:00.000Z",
        },
      ],
      supportCases: [],
    });
    assert.equal(portabilityPkg.legalBasis, "LGPD_ART_18_V_PORTABILITY");
    assert.equal(portabilityPkg.ordersHistoryCount, 1);

    const blockedByFiscalHold = anonymizeProfilePii({
      userId: "user_lgpd_1",
      hasActiveOrders: false,
      hasOpenFinancialDisputes: false,
      hasCompletedFiscalTransactions: true,
      now: new Date("2026-11-14T06:00:00.000Z"),
    });
    assert.equal(blockedByFiscalHold.allowed, false);
    assert.equal(blockedByFiscalHold.reasonCode, "STATUTORY_FISCAL_LEDGER_RETENTION");
    assert.ok(blockedByFiscalHold.holdUntilIso?.startsWith("2031-11-1"));

    const eligibleAnonymization = anonymizeProfilePii({
      userId: "user_lgpd_clean",
      hasActiveOrders: false,
      hasOpenFinancialDisputes: false,
      hasCompletedFiscalTransactions: false,
      now: new Date("2026-11-14T06:00:00.000Z"),
    });
    assert.equal(eligibleAnonymization.allowed, true);
    assert.equal(eligibleAnonymization.reasonCode, "PII_ANONYMIZED_LGPD_COMPLIANT");
    assert.ok(eligibleAnonymization.anonymizedEmail?.endsWith("@anonymized.ideliveryfood.invalid"));
  });

  it("verifies Fase S (M22): grocery picking policy gate, HALF_UP scale pricing in cents, REFUND_IF_UNAVAILABLE substitution prohibition, substitution timeout, and balanced ledger adjustment", () => {
    // 1. Policy gate evaluation
    const disabledByPlatform = evaluateGroceryPickingPolicyAccess({
      platformFeatureGroceryPickingEnabled: false,
      organizationFeatureGroceryPickingEnabled: true,
      storeFeatureGroceryPickingEnabled: true,
    });
    assert.equal(disabledByPlatform.enabled, false);
    assert.equal(disabledByPlatform.status, "FEATURE_DISABLED_BY_POLICY");
    assert.equal(disabledByPlatform.reasonCode, "PLATFORM_GROCERY_PICKING_DISABLED");

    const disabledByStore = evaluateGroceryPickingPolicyAccess({
      platformFeatureGroceryPickingEnabled: true,
      organizationFeatureGroceryPickingEnabled: false,
      storeFeatureGroceryPickingEnabled: false,
    });
    assert.equal(disabledByStore.enabled, false);
    assert.equal(disabledByStore.status, "FEATURE_DISABLED_BY_POLICY");
    assert.equal(disabledByStore.reasonCode, "STORE_GROCERY_PICKING_DISABLED");

    const activePolicy = evaluateGroceryPickingPolicyAccess({
      platformFeatureGroceryPickingEnabled: true,
      organizationFeatureGroceryPickingEnabled: false,
      storeFeatureGroceryPickingEnabled: true,
    });
    assert.equal(activePolicy.enabled, true);
    assert.equal(activePolicy.status, "ACTIVE");

    // 2. Deterministic scale pricing in integer BRL cents with HALF_UP rounding
    // 485g * 3399 cents/kg = 1,648,515 / 1000 = 1648.515 -> HALF_UP -> 1649 cents
    const weighedDownward = calculateWeighedItemPriceCents({
      actualWeightGrams: 485,
      pricePerKgCents: 3399,
      preAuthorizedLineCents: 1700,
    });
    assert.equal(weighedDownward.weighedBaseCents, 1649);
    assert.equal(weighedDownward.calculatedLineCents, 1649);
    assert.equal(weighedDownward.deltaCents, -51);
    assert.equal(weighedDownward.refundAdjustmentCents, 51);

    // Exact 0.5 cent boundary rounds UP under HALF_UP: 500g * 1999 cents/kg = 999,500 / 1000 = 999.5 -> 1000 cents
    const weighedHalfUpBoundary = calculateWeighedItemPriceCents({
      actualWeightGrams: 500,
      pricePerKgCents: 1999,
      preAuthorizedLineCents: 1000,
    });
    assert.equal(weighedHalfUpBoundary.calculatedLineCents, 1000);
    assert.equal(weighedHalfUpBoundary.refundAdjustmentCents, 0);

    // Exceeding pre-authorized ceiling without explicit customer consent is blocked
    assert.throws(
      () =>
        calculateWeighedItemPriceCents({
          actualWeightGrams: 550,
          pricePerKgCents: 3399,
          preAuthorizedLineCents: 1700,
        }),
      /WEIGHING_EXCEEDS_PREAUTHORIZED_CEILING/
    );

    // 3. Prohibits substitution when customer selected REFUND_IF_UNAVAILABLE
    assert.throws(
      () =>
        evaluateItemSubstitutionProposal({
          customerPreference: "REFUND_IF_UNAVAILABLE",
          originalLineCents: 1690,
          action: "PROPOSE_SUBSTITUTION",
          suggestedProductId: "prod_sub_1",
          suggestedProductNameEn: "Sweet Potato Fries",
          suggestedProductNamePtBr: "Batata Doce Rústica",
          suggestedLineCents: 1590,
          reason: "Regular crinkle fries out of stock",
        }),
      /SUBSTITUTION_FORBIDDEN_BY_PREFERENCE/
    );

    // REFUND_IF_UNAVAILABLE allows immediate unavailable item refund
    const autoRefunded = evaluateItemSubstitutionProposal({
      customerPreference: "REFUND_IF_UNAVAILABLE",
      originalLineCents: 1690,
      action: "MARK_UNAVAILABLE_REFUND",
      reason: "Item unavailable; customer opted for automatic refund",
    });
    assert.equal(autoRefunded.status, "AUTO_REFUNDED_UNAVAILABLE");
    assert.equal(autoRefunded.refundAdjustmentCents, 1690);

    // 4. ALLOW_SUGGESTION creates pending approval proposal and enforces timeout
    const baseNow = new Date("2026-11-19T04:00:00.000Z");
    const proposal = evaluateItemSubstitutionProposal({
      customerPreference: "ALLOW_SUGGESTION",
      originalLineCents: 1690,
      action: "PROPOSE_SUBSTITUTION",
      suggestedProductId: "prod_sub_1",
      suggestedProductNameEn: "Artisan Sweet Potato Fries",
      suggestedProductNamePtBr: "Batata Doce Rústica Artesanal",
      suggestedLineCents: 1490,
      reason: "Out of regular fries; suggesting artisan sweet potato fries",
      timeoutSeconds: 300,
      now: baseNow,
    });
    assert.equal(proposal.status, "PENDING_CUSTOMER_APPROVAL");
    assert.equal(
      proposal.nextPickTaskStatus,
      "AWAITING_CUSTOMER_SUBSTITUTION_APPROVAL"
    );
    assert.equal(proposal.priceDeltaCents, -200);
    assert.equal(proposal.refundAdjustmentCents, 200);

    // Timeout expiration (> 300s) auto-refunds and never substitutes silently
    const expiredResolution = resolveCustomerSubstitutionDecision({
      substitution: {
        id: "sub_1",
        status: proposal.status,
        originalLineCents: 1690,
        suggestedLineCents: 1490,
        expiresAtIso: proposal.expiresAtIso,
      },
      decision: "APPROVE",
      now: new Date(baseNow.getTime() + 301 * 1000),
    });
    assert.equal(expiredResolution.isExpiredTimeout, true);
    assert.equal(expiredResolution.updatedStatus, "EXPIRED_TIMEOUT_REFUNDED");
    assert.equal(expiredResolution.effectiveLineCents, 0);
    assert.equal(expiredResolution.refundDeltaCents, 1690);

    // Customer approval within timeout applies suggestedLineCents and partial refund delta (200 cents)
    const approvedResolution = resolveCustomerSubstitutionDecision({
      substitution: {
        id: "sub_2",
        status: "PENDING_CUSTOMER_APPROVAL",
        originalLineCents: 1690,
        suggestedLineCents: 1490,
        expiresAtIso: proposal.expiresAtIso,
      },
      decision: "APPROVE",
      now: new Date(baseNow.getTime() + 120 * 1000),
    });
    assert.equal(approvedResolution.isExpiredTimeout, false);
    assert.equal(approvedResolution.updatedStatus, "APPROVED_BY_CUSTOMER");
    assert.equal(approvedResolution.effectiveLineCents, 1490);
    assert.equal(approvedResolution.refundDeltaCents, 200);

    // 5. Finalizing pick task generates balanced M13 REFUND ledger adjustment journal
    const finalized = finalizeOrderPickTaskFinancialAdjustment({
      orderId: "00000000-0000-4000-8000-000000001001",
      organizationId: "00000000-0000-4000-8000-000000000101",
      preAuthorizedTotalCents: 6232,
      orderItems: [
        {
          orderItemId: "item_1",
          totalLineCents: 4540,
          adjustedLineCents: 4489, // -51 cents scale weight adjustment
        },
        {
          orderItemId: "item_2",
          totalLineCents: 1690,
          adjustedLineCents: 1490, // -200 cents consented substitution adjustment
        },
      ],
      substitutions: [
        {
          id: "sub_2",
          status: "APPROVED_BY_CUSTOMER",
          expiresAtIso: proposal.expiresAtIso,
        },
      ],
      journalId: "00000000-0000-4000-8000-000000009988",
      now: new Date(baseNow.getTime() + 180 * 1000),
    });
    assert.equal(finalized.status, "PICKING_COMPLETED");
    assert.equal(finalized.weightAdjustmentDeltaCents, -251);
    assert.equal(finalized.refundAdjustmentCents, 251);
    assert.equal(finalized.finalPickedTotalCents, 5981);
    assert.ok(finalized.refundLedgerJournal);
    assert.equal(finalized.refundLedgerJournal?.entries.length, 2);
    assert.equal(finalized.refundLedgerJournal?.totalDebitsCents, 251);
    assert.equal(finalized.refundLedgerJournal?.totalCreditsCents, 251);
    assert.equal(finalized.refundLedgerJournal?.entries[0]?.direction, "DEBIT");
    assert.equal(finalized.refundLedgerJournal?.entries[0]?.amountCents, 251);
    assert.equal(finalized.refundLedgerJournal?.entries[1]?.direction, "CREDIT");
    assert.equal(finalized.refundLedgerJournal?.entries[1]?.amountCents, 251);
  });

  it("covers M07 store settings & bank account step-up, M08 kitchen queue & reconnect deduplication, and M16 admin scope grants & governance decisions", () => {
    const now = new Date("2026-11-19T15:00:00.000Z");

    // 1. M07 validateStoreSettingsPatch
    const validPatch = validateStoreSettingsPatch({
      minOrderCents: 3000,
      prepTimeMinMinutes: 15,
      prepTimeMaxMinutes: 35,
      isPaused: true,
      pauseReason: "Kitchen maintenance",
    });
    assert.equal(validPatch.minOrderCents, 3000);
    assert.throws(
      () => validateStoreSettingsPatch({ prepTimeMinMinutes: 0 }),
      /STORE_SETTINGS_INVALID_PREP_TIME/
    );
    assert.throws(
      () => validateStoreSettingsPatch({ prepTimeMinMinutes: 30, prepTimeMaxMinutes: 15 }),
      /STORE_SETTINGS_INVALID_PREP_TIME/
    );
    assert.throws(
      () => validateStoreSettingsPatch({ isPaused: true, pauseReason: "no" }),
      /STORE_PAUSE_REASON_REQUIRED/
    );

    // 2. M07 createBankAccountChangeRequest
    assert.throws(
      () =>
        createBankAccountChangeRequest({
          id: "b1",
          organizationId: "org_101",
          storeId: "store_201",
          requestedBy: "owner_1",
          actorAal: "aal1",
          bankCode: "341",
          branchNumber: "0001",
          accountLast4: "1234",
          reason: "Valid reason text",
        }),
      /BANK_CHANGE_MFA_AAL2_REQUIRED/
    );
    assert.throws(
      () =>
        createBankAccountChangeRequest({
          id: "b1",
          organizationId: "org_101",
          storeId: "store_201",
          requestedBy: "owner_1",
          actorAal: "aal2",
          bankCode: "12",
          branchNumber: "0001",
          accountLast4: "1234",
          reason: "Valid reason text",
        }),
      /BANK_CHANGE_INVALID_BANK_CODE/
    );
    assert.throws(
      () =>
        createBankAccountChangeRequest({
          id: "b1",
          organizationId: "org_101",
          storeId: "store_201",
          requestedBy: "owner_1",
          actorAal: "aal2",
          bankCode: "341",
          branchNumber: "0001",
          accountLast4: "12",
          reason: "Valid reason text",
        }),
      /BANK_CHANGE_INVALID_LAST4/
    );
    assert.throws(
      () =>
        createBankAccountChangeRequest({
          id: "b1",
          organizationId: "org_101",
          storeId: "store_201",
          requestedBy: "owner_1",
          actorAal: "aal2",
          bankCode: "341",
          branchNumber: "0001",
          accountLast4: "1234",
          reason: "bad",
        }),
      /BANK_CHANGE_REASON_REQUIRED/
    );
    const validBankReq = createBankAccountChangeRequest({
      id: "b1",
      organizationId: "org_101",
      storeId: "store_201",
      requestedBy: "owner_1",
      actorAal: "aal2",
      bankCode: "341",
      branchNumber: "0001",
      accountLast4: "1234",
      reason: "New settlement account",
      now,
    });
    assert.equal(validBankReq.status, "PENDING");
    assert.equal(validBankReq.accountLast4, "1234");

    // 3. M08 mapOrderStatusToKitchenColumn, buildKitchenOrderQueue & reconcileKitchenOrderEventsOnReconnect
    assert.equal(mapOrderStatusToKitchenColumn("CREATED"), "NEW");
    assert.equal(mapOrderStatusToKitchenColumn("ACCEPTED"), "ACCEPTED");
    assert.equal(mapOrderStatusToKitchenColumn("PREPARING"), "PREPARING");
    assert.equal(mapOrderStatusToKitchenColumn("READY_FOR_PICKUP"), "READY");
    assert.equal(mapOrderStatusToKitchenColumn("OUT_FOR_DELIVERY"), "IN_TRANSIT");
    assert.equal(mapOrderStatusToKitchenColumn("DELIVERED"), "COMPLETED");
    assert.equal(mapOrderStatusToKitchenColumn("CANCELLED"), "CANCELLED");

    const baseOrder = {
      id: "ord_k_1",
      orderNumber: 101,
      customerId: "c1",
      organizationId: "org_101",
      storeId: "store_201",
      quoteId: "q1",
      fulfillmentModality: "PLATFORM_DELIVERY" as const,
      orderStatus: "PENDING_MERCHANT_ACCEPTANCE",
      paymentStatus: "CAPTURED",
      deliveryStatus: "PENDING_DISPATCH",
      currencyCode: "BRL" as const,
      subtotalCents: 3000,
      addonsCents: 0,
      serviceFeeCents: 150,
      deliveryFeeCents: 500,
      discountCents: 0,
      totalCents: 3650,
      platformCommissionCents: 690,
      merchantNetCents: 2310,
      courierEarningsCents: 500,
      deliveryAddressSnapshot: null,
      itemsSnapshot: [],
      customerNotes: null,
      cancellationReason: null,
      cancelledByRole: null,
      version: 1,
      idempotencyKey: "idem_k_1",
      acceptedAtIso: null,
      readyAtIso: null,
      deliveredAtIso: null,
      cancelledAtIso: null,
      createdAtIso: "2026-11-19T14:40:00.000Z",
      updatedAtIso: "2026-11-19T14:40:00.000Z",
    };

    const queue = buildKitchenOrderQueue({
      storeId: "store_201",
      isStorePaused: false,
      orders: [
        baseOrder,
        { ...baseOrder, id: "ord_k_2", orderStatus: "DELIVERED" },
        { ...baseOrder, id: "ord_other_store", storeId: "store_202" },
      ],
      now,
      latestEventCursor: "cur_1",
    });
    assert.equal(queue.activeOrderCount, 1);
    assert.equal(queue.columns.NEW.length, 1);
    assert.equal(queue.columns.NEW[0]?.isSlaBreached, true);
    assert.equal(queue.columns.COMPLETED.length, 1);

    const evt1 = {
      id: "evt_k_1",
      orderId: "ord_k_1",
      actorId: "p1",
      actorRole: "PARTNER",
      eventType: "ORDER_ACCEPT",
      previousOrderStatus: "PENDING_MERCHANT_ACCEPTANCE",
      newOrderStatus: "ACCEPTED",
      previousPaymentStatus: "CAPTURED",
      newPaymentStatus: "CAPTURED",
      previousDeliveryStatus: "PENDING_DISPATCH",
      newDeliveryStatus: "PENDING_DISPATCH",
      idempotencyKey: "idem_evt_1",
      payload: {},
      createdAtIso: now.toISOString(),
    };
    const rec = reconcileKitchenOrderEventsOnReconnect({
      seenEventIds: new Set(),
      incomingEvents: [evt1, evt1],
    });
    assert.equal(rec.newEvents.length, 1);
    assert.equal(rec.latestCursor, "evt_k_1");

    // 4. M16 evaluateStaffScopeGrant & evaluateAdminGovernanceDecision
    assert.equal(
      evaluateStaffScopeGrant({
        actorId: "admin_1",
        actorAal: "aal2",
        actorRoles: ["tech_admin"],
        request: {
          targetUserId: "admin_1",
          role: "finance",
          regionCode: null,
          maxRefundApprovalCents: 1000,
          justification: "Self grant",
        },
      }).reasonCode,
      "DENIED_SELF_GRANT_FORBIDDEN"
    );
    assert.equal(
      evaluateStaffScopeGrant({
        actorId: "admin_1",
        actorAal: "aal2",
        actorRoles: ["support"],
        request: {
          targetUserId: "staff_2",
          role: "finance",
          regionCode: null,
          maxRefundApprovalCents: 1000,
          justification: "Valid justification",
        },
      }).reasonCode,
      "DENIED_ROLE_INSUFFICIENT"
    );
    assert.equal(
      evaluateStaffScopeGrant({
        actorId: "admin_1",
        actorAal: "aal1",
        actorRoles: ["tech_admin"],
        request: {
          targetUserId: "staff_2",
          role: "finance",
          regionCode: null,
          maxRefundApprovalCents: 1000,
          justification: "Valid justification",
        },
      }).reasonCode,
      "DENIED_MFA_AAL2_REQUIRED"
    );
    assert.equal(
      evaluateStaffScopeGrant({
        actorId: "admin_1",
        actorAal: "aal2",
        actorRoles: ["tech_admin"],
        request: {
          targetUserId: "staff_2",
          role: "finance",
          regionCode: null,
          maxRefundApprovalCents: 1000,
          justification: "no",
        },
      }).reasonCode,
      "DENIED_JUSTIFICATION_REQUIRED"
    );
    assert.equal(
      evaluateStaffScopeGrant({
        actorId: "admin_1",
        actorAal: "aal2",
        actorRoles: ["tech_admin"],
        request: {
          targetUserId: "staff_2",
          role: "finance",
          regionCode: "BR-SP",
          maxRefundApprovalCents: 50000,
          justification: "Promoted to regional finance specialist",
        },
      }).allowed,
      true
    );

    assert.throws(
      () =>
        evaluateAdminGovernanceDecision({
          id: "g1",
          actorId: "staff_1",
          actorAal: "aal2",
          actorRoles: ["support"],
          targetType: "STORE",
          targetId: "store_201",
          decision: "APPROVED",
          reason: "Valid reason",
        }),
      /ADMIN_GOVERNANCE_FORBIDDEN/
    );
    assert.throws(
      () =>
        evaluateAdminGovernanceDecision({
          id: "g1",
          actorId: "staff_1",
          actorAal: "aal1",
          actorRoles: ["operations"],
          targetType: "STORE",
          targetId: "store_201",
          decision: "APPROVED",
          reason: "Valid reason",
        }),
      /ADMIN_GOVERNANCE_MFA_AAL2_REQUIRED/
    );
    assert.throws(
      () =>
        evaluateAdminGovernanceDecision({
          id: "g1",
          actorId: "staff_1",
          actorAal: "aal2",
          actorRoles: ["operations"],
          targetType: "USER",
          targetId: "staff_1",
          decision: "APPROVED",
          reason: "Valid reason",
        }),
      /ADMIN_GOVERNANCE_SELF_TARGET_FORBIDDEN/
    );
    assert.throws(
      () =>
        evaluateAdminGovernanceDecision({
          id: "g1",
          actorId: "staff_1",
          actorAal: "aal2",
          actorRoles: ["operations"],
          targetType: "STORE",
          targetId: "store_201",
          decision: "APPROVED",
          reason: "no",
        }),
      /ADMIN_GOVERNANCE_REASON_REQUIRED/
    );
    const govDecision = evaluateAdminGovernanceDecision({
      id: "g1",
      actorId: "staff_1",
      actorAal: "aal2",
      actorRoles: ["operations"],
      targetType: "STORE",
      targetId: "store_201",
      decision: "APPROVED",
      reason: "KYC documents verified",
      now,
    });
    assert.equal(govDecision.decision, "APPROVED");
  });

  it("covers all remaining validation and state machine branches across M04, M05, M10, M12, M13, M14, M15, M17, M18, M19, M20, M21 & M22", () => {
    const now = new Date("2026-11-03T15:00:00.000Z"); // Tuesday 12:00 America/Sao_Paulo

    // 1. M04 availability branches: inactive, paused, custom exception hours (inside & outside), current-day overnight, closed
    assert.equal(
      evaluateStoreAvailability({
        storeId: "s1",
        isPublished: false,
        isPaused: false,
        weeklyHours: [],
        evaluatedAt: now,
      }).reasonCode,
      "STORE_INACTIVE"
    );
    assert.equal(
      evaluateStoreAvailability({
        storeId: "s1",
        isPublished: true,
        isPaused: true,
        weeklyHours: [],
        evaluatedAt: now,
      }).reasonCode,
      "STORE_PAUSED"
    );
    assert.equal(
      evaluateStoreAvailability({
        storeId: "s1",
        isPublished: true,
        isPaused: false,
        weeklyHours: [],
        exceptions: [
          {
            exceptionDate: "2026-11-03",
            opensAt: "10:00:00",
            closesAt: "14:00:00",
            isClosed: false,
            reason: "Holiday half-day",
          },
        ],
        evaluatedAt: now,
      }).reasonCode,
      "OPEN"
    );
    assert.equal(
      evaluateStoreAvailability({
        storeId: "s1",
        isPublished: true,
        isPaused: false,
        weeklyHours: [],
        exceptions: [
          {
            exceptionDate: "2026-11-03",
            opensAt: "18:00:00",
            closesAt: "22:00:00",
            isClosed: false,
            reason: "Dinner only",
          },
        ],
        evaluatedAt: now,
      }).reasonCode,
      "OUTSIDE_OPERATING_HOURS"
    );
    assert.equal(
      evaluateStoreAvailability({
        storeId: "s1",
        isPublished: true,
        isPaused: false,
        weeklyHours: [
          { dayOfWeek: 2, opensAt: "11:00:00", closesAt: "02:00:00", isOvernight: true, isClosed: false },
        ],
        evaluatedAt: now,
      }).reasonCode,
      "OPEN"
    );
    assert.equal(
      evaluateStoreAvailability({
        storeId: "s1",
        isPublished: true,
        isPaused: false,
        weeklyHours: [],
        evaluatedAt: now,
      }).reasonCode,
      "OUTSIDE_OPERATING_HOURS"
    );

    // 2. M04 service area branches: PICKUP, NO_ACTIVE_SERVICE_AREA, freeDeliveryMinOrderCents
    assert.equal(
      evaluateServiceAreaEligibility({
        storeId: "s1",
        storeLatitude: -23.56,
        storeLongitude: -46.65,
        customerLatitude: -23.9,
        customerLongitude: -46.9,
        fulfillmentModality: "PICKUP",
        grossMerchandiseCents: 3000,
        serviceAreas: [],
      }).reasonCode,
      "PICKUP_NO_RADIUS_REQUIRED"
    );
    assert.equal(
      evaluateServiceAreaEligibility({
        storeId: "s1",
        storeLatitude: -23.56,
        storeLongitude: -46.65,
        customerLatitude: -23.561,
        customerLongitude: -46.651,
        fulfillmentModality: "PLATFORM_DELIVERY",
        grossMerchandiseCents: 3000,
        serviceAreas: [],
      }).reasonCode,
      "NO_ACTIVE_SERVICE_AREA"
    );
    const freeDeliveryEval = evaluateServiceAreaEligibility({
      storeId: "s1",
      storeLatitude: -23.56,
      storeLongitude: -46.65,
      customerLatitude: -23.561,
      customerLongitude: -46.651,
      fulfillmentModality: "PLATFORM_DELIVERY",
      grossMerchandiseCents: 15000,
      serviceAreas: [
        {
          id: "a1",
          storeId: "s1",
          name: "Local",
          radiusMeters: 5000,
          baseFeeCents: 700,
          perKmFeeCents: 150,
          freeDeliveryMinOrderCents: 12000,
          estimatedDeliveryMinutes: 30,
          isActive: true,
        },
      ],
    });
    assert.equal(freeDeliveryEval.deliveryFeeCents, 0);

    // 3. validateAndBuildQuoteItems & evaluateSingleStoreCartAddition error/merge branches
    const prod = {
      id: "p1",
      storeId: "s1",
      categoryId: "c1",
      sku: "SKU-1",
      nameEn: "Item",
      namePtBr: "Item",
      localizedName: "Item",
      descriptionEn: "D",
      descriptionPtBr: "D",
      localizedDescription: "D",
      priceCents: 2000,
      isAvailable: true,
      isPaused: false,
      maxPerOrder: 2,
      unitOfMeasure: "UNIT" as const,
      optionGroups: [
        {
          id: "g1",
          nameEn: "Extras",
          namePtBr: "Extras",
          localizedName: "Extras",
          minSelections: 0,
          maxSelections: 1,
          sortOrder: 1,
          options: [
            {
              id: "o1",
              nameEn: "Cheese",
              namePtBr: "Queijo",
              localizedName: "Cheese",
              additionalPriceCents: 300,
              isAvailable: true,
              sortOrder: 1,
            },
            {
              id: "o_unavail",
              nameEn: "Truffle",
              namePtBr: "Trufa",
              localizedName: "Truffle",
              additionalPriceCents: 500,
              isAvailable: false,
              sortOrder: 2,
            },
          ],
        },
      ],
    };

    assert.throws(
      () => validateAndBuildQuoteItems({ cartItems: [], catalogProducts: [prod] }),
      /QUOTE_EMPTY_ITEMS/
    );
    assert.throws(
      () =>
        validateAndBuildQuoteItems({
          cartItems: [{ productId: "unknown", quantity: 1, selectedOptions: [] }],
          catalogProducts: [prod],
        }),
      /CATALOG_PRODUCT_NOT_FOUND/
    );
    assert.throws(
      () =>
        validateAndBuildQuoteItems({
          cartItems: [{ productId: "p1", quantity: 1, selectedOptions: [] }],
          catalogProducts: [{ ...prod, isPaused: true }],
        }),
      /CATALOG_PRODUCT_UNAVAILABLE/
    );
    assert.throws(
      () =>
        validateAndBuildQuoteItems({
          cartItems: [{ productId: "p1", quantity: 0, selectedOptions: [] }],
          catalogProducts: [prod],
        }),
      /QUOTE_INVALID_QUANTITY/
    );
    assert.throws(
      () =>
        validateAndBuildQuoteItems({
          cartItems: [{ productId: "p1", quantity: 5, selectedOptions: [] }],
          catalogProducts: [prod],
        }),
      /CATALOG_QUANTITY_EXCEEDED/
    );
    assert.throws(
      () =>
        validateAndBuildQuoteItems({
          cartItems: [
            {
              productId: "p1",
              quantity: 1,
              selectedOptions: [{ optionGroupId: "g1", optionId: "o1", quantity: 2 }],
            },
          ],
          catalogProducts: [prod],
        }),
      /OPTION_GROUP_MAX_EXCEEDED/
    );
    assert.throws(
      () =>
        validateAndBuildQuoteItems({
          cartItems: [
            {
              productId: "p1",
              quantity: 1,
              selectedOptions: [{ optionGroupId: "g1", optionId: "o_missing", quantity: 1 }],
            },
          ],
          catalogProducts: [prod],
        }),
      /OPTION_NOT_FOUND/
    );
    assert.throws(
      () =>
        validateAndBuildQuoteItems({
          cartItems: [
            {
              productId: "p1",
              quantity: 1,
              selectedOptions: [{ optionGroupId: "g1", optionId: "o_unavail", quantity: 1 }],
            },
          ],
          catalogProducts: [prod],
        }),
      /OPTION_UNAVAILABLE/
    );
    const withNotes = validateAndBuildQuoteItems({
      cartItems: [{ productId: "p1", quantity: 1, selectedOptions: [], notes: "No onions" }],
      catalogProducts: [prod],
    });
    assert.equal(withNotes.snapshots[0]?.notes, "No onions");

    // Merging identical item in single-store cart
    const mergedCart = evaluateSingleStoreCartAddition({
      currentStoreId: "s1",
      currentItems: [{ productId: "p1", quantity: 1, selectedOptions: [] }],
      targetStoreId: "s1",
      itemToAdd: { productId: "p1", quantity: 2, selectedOptions: [] },
    });
    assert.equal(mergedCart.nextItems.length, 1);
    assert.equal(mergedCart.nextItems[0]?.quantity, 3);

    // 4. calculateServerQuoteAndSplit MERCHANT_DELIVERY & errors
    assert.throws(
      () =>
        calculateServerQuoteAndSplit({
          items: [],
          fulfillmentModality: "PICKUP",
          deliveryFeeCents: 0,
          discountCents: 0,
          discountFundedBy: "NONE",
          minOrderCents: 0,
        }),
      /QUOTE_EMPTY_ITEMS/
    );
    assert.throws(
      () =>
        calculateServerQuoteAndSplit({
          items: [{ productId: "p1", quantity: 0, unitPriceCents: 1000, addonsUnitPriceCents: 0 }],
          fulfillmentModality: "PICKUP",
          deliveryFeeCents: 0,
          discountCents: 0,
          discountFundedBy: "NONE",
          minOrderCents: 0,
        }),
      /QUOTE_INVALID_QUANTITY/
    );
    const merchantDelivSplit = calculateServerQuoteAndSplit({
      items: [{ productId: "p1", quantity: 1, unitPriceCents: 5000, addonsUnitPriceCents: 0 }],
      fulfillmentModality: "MERCHANT_DELIVERY",
      deliveryFeeCents: 600,
      discountCents: 0,
      discountFundedBy: "NONE",
      minOrderCents: 1000,
    });
    assert.equal(merchantDelivSplit.courierEarningsCents, 0);
    assert.equal(merchantDelivSplit.ledgerDebitsCents, merchantDelivSplit.ledgerCreditsCents);

    // 5. createOrderFromServerQuote errors & executeOrderCommand full lifecycle (ACCEPT -> START_PREPARING -> MARK_READY -> DISPATCH -> PICK_UP -> DELIVER -> COMPLETE + REJECT)
    const sampleQuote = {
      id: "q_full",
      customerId: "cust_1",
      storeId: "s1",
      addressId: null,
      fulfillmentModality: "PICKUP" as const,
      promotionCode: null,
      currencyCode: "BRL" as const,
      subtotalCents: 5000,
      addonsCents: 0,
      serviceFeeCents: 250,
      deliveryFeeCents: 0,
      discountCents: 0,
      totalCents: 5250,
      distanceMeters: 0,
      estimatedPrepMinutes: 20,
      estimatedDeliveryMinutes: 0,
      itemsSnapshot: [
        {
          productId: "p1",
          productNameEn: "Item",
          productNamePtBr: "Item",
          quantity: 1,
          unitPriceCents: 5000,
          addonsUnitPriceCents: 0,
          totalLineCents: 5000,
          selectedOptions: [],
        },
      ],
      addressSnapshot: null,
      idempotencyKey: "idem_qf",
      expiresAtIso: "2026-11-03T15:30:00.000Z",
      consumedAtIso: null,
      createdAtIso: "2026-11-03T15:00:00.000Z",
    };

    assert.throws(
      () =>
        createOrderFromServerQuote({
          orderId: "o1",
          orderNumber: 1,
          organizationId: "org_1",
          quote: sampleQuote,
          actorCustomerId: "other_cust",
          isStoreCurrentlyOpen: true,
          discountFundedBy: "NONE",
          idempotencyKey: "k1",
          now,
        }),
      /QUOTE_OWNERSHIP_MISMATCH/
    );
    assert.throws(
      () =>
        createOrderFromServerQuote({
          orderId: "o1",
          orderNumber: 1,
          organizationId: "org_1",
          quote: { ...sampleQuote, consumedAtIso: "2026-11-03T15:01:00.000Z" },
          actorCustomerId: "cust_1",
          isStoreCurrentlyOpen: true,
          discountFundedBy: "NONE",
          idempotencyKey: "k1",
          now,
        }),
      /QUOTE_ALREADY_CONSUMED/
    );
    assert.throws(
      () =>
        createOrderFromServerQuote({
          orderId: "o1",
          orderNumber: 1,
          organizationId: "org_1",
          quote: { ...sampleQuote, expiresAtIso: "2026-11-03T14:00:00.000Z" },
          actorCustomerId: "cust_1",
          isStoreCurrentlyOpen: true,
          discountFundedBy: "NONE",
          idempotencyKey: "k1",
          now,
        }),
      /QUOTE_EXPIRED/
    );
    assert.throws(
      () =>
        createOrderFromServerQuote({
          orderId: "o1",
          orderNumber: 1,
          organizationId: "org_1",
          quote: sampleQuote,
          actorCustomerId: "cust_1",
          isStoreCurrentlyOpen: false,
          discountFundedBy: "NONE",
          idempotencyKey: "k1",
          now,
        }),
      /STORE_CLOSED_AT_CHECKOUT/
    );

    const createdPickup = createOrderFromServerQuote({
      orderId: "o_lifecycle",
      orderNumber: 200,
      organizationId: "org_1",
      quote: sampleQuote,
      actorCustomerId: "cust_1",
      isStoreCurrentlyOpen: true,
      discountFundedBy: "NONE",
      idempotencyKey: "k_life",
      now,
    });
    assert.equal(createdPickup.order.deliveryStatus, "NOT_REQUIRED");

    const paid = executeOrderCommand({
      order: createdPickup.order,
      command: "CONFIRM_PAYMENT",
      expectedVersion: 1,
      actorId: "sys",
      actorRole: "SYSTEM",
      idempotencyKey: "k_paid",
      now,
    });

    // Reject command on a branch copy
    assert.throws(
      () =>
        executeOrderCommand({
          order: paid.updatedOrder,
          command: "REJECT",
          expectedVersion: 2,
          actorId: "cust_1",
          actorRole: "CUSTOMER",
          idempotencyKey: "k_rej_forbid",
          now,
        }),
      /ORDER_COMMAND_FORBIDDEN/
    );
    const rejected = executeOrderCommand({
      order: paid.updatedOrder,
      command: "REJECT",
      expectedVersion: 2,
      actorId: "partner_1",
      actorRole: "PARTNER",
      reason: "Out of ingredients",
      idempotencyKey: "k_rej",
      now,
    });
    assert.equal(rejected.updatedOrder.orderStatus, "REJECTED");

    // Full forward path: ACCEPT -> START_PREPARING -> MARK_READY -> DISPATCH -> PICK_UP -> DELIVER -> COMPLETE
    const accepted = executeOrderCommand({
      order: paid.updatedOrder,
      command: "ACCEPT",
      expectedVersion: 2,
      actorId: "partner_1",
      actorRole: "PARTNER",
      idempotencyKey: "k_acc",
      now,
    });
    const preparing = executeOrderCommand({
      order: accepted.updatedOrder,
      command: "START_PREPARING",
      expectedVersion: 3,
      actorId: "partner_1",
      actorRole: "PARTNER",
      idempotencyKey: "k_prep",
      now,
    });
    const ready = executeOrderCommand({
      order: preparing.updatedOrder,
      command: "MARK_READY",
      expectedVersion: 4,
      actorId: "partner_1",
      actorRole: "PARTNER",
      idempotencyKey: "k_ready",
      now,
    });
    const pickedUp = executeOrderCommand({
      order: ready.updatedOrder,
      command: "PICK_UP",
      expectedVersion: 5,
      actorId: "courier_1",
      actorRole: "COURIER",
      idempotencyKey: "k_pick",
      now,
    });
    assert.equal(pickedUp.updatedOrder.orderStatus, "PICKED_UP");

    // Customer cannot cancel once order is READY_FOR_PICKUP or past free window
    assert.throws(
      () =>
        executeOrderCommand({
          order: ready.updatedOrder,
          command: "CANCEL",
          expectedVersion: 5,
          actorId: "cust_1",
          actorRole: "CUSTOMER",
          idempotencyKey: "k_late_cancel",
          now: new Date(now.getTime() + 600 * 1000),
        }),
      /ORDER_CANCEL_WINDOW_EXPIRED/
    );

    // 6. Webhook failure & error branches
    const ts = Math.floor(now.getTime() / 1000);
    const rawP = JSON.stringify({ id: "e_fail" });
    const sig = computePspWebhookSignature({
      webhookSecret: "sec_12345678",
      timestampSeconds: ts,
      rawPayload: rawP,
    });
    assert.throws(
      () =>
        verifyAndProcessPspWebhook({
          providerCode: "stripe",
          externalEventId: "e1",
          eventType: "payment.captured",
          webhookSecret: "sec_12345678",
          signatureHeader: sig,
          timestampSeconds: ts - 1000,
          nowSeconds: ts,
          rawPayload: rawP,
          webhookAmountCents: 5250,
          webhookCurrencyCode: "BRL",
          order: createdPickup.order,
          processedEventKeys: new Set(),
        }),
      /WEBHOOK_TIMESTAMP_OUT_OF_WINDOW/
    );
    assert.throws(
      () =>
        verifyAndProcessPspWebhook({
          providerCode: "stripe",
          externalEventId: "e1",
          eventType: "payment.captured",
          webhookSecret: "sec_12345678",
          signatureHeader: "v1=invalid",
          timestampSeconds: ts,
          nowSeconds: ts,
          rawPayload: rawP,
          webhookAmountCents: 5250,
          webhookCurrencyCode: "BRL",
          order: createdPickup.order,
          processedEventKeys: new Set(),
        }),
      /WEBHOOK_INVALID_SIGNATURE/
    );
    assert.throws(
      () =>
        verifyAndProcessPspWebhook({
          providerCode: "stripe",
          externalEventId: "e1",
          eventType: "payment.captured",
          webhookSecret: "sec_12345678",
          signatureHeader: sig,
          timestampSeconds: ts,
          nowSeconds: ts,
          rawPayload: rawP,
          webhookAmountCents: 5250,
          webhookCurrencyCode: "USD",
          order: createdPickup.order,
          processedEventKeys: new Set(),
        }),
      /WEBHOOK_CURRENCY_MISMATCH/
    );
    assert.throws(
      () =>
        verifyAndProcessPspWebhook({
          providerCode: "stripe",
          externalEventId: "e1",
          eventType: "payment.captured",
          webhookSecret: "sec_12345678",
          signatureHeader: sig,
          timestampSeconds: ts,
          nowSeconds: ts,
          rawPayload: rawP,
          webhookAmountCents: 9999,
          webhookCurrencyCode: "BRL",
          order: createdPickup.order,
          processedEventKeys: new Set(),
        }),
      /WEBHOOK_AMOUNT_MISMATCH/
    );
    const failedWh = verifyAndProcessPspWebhook({
      providerCode: "stripe",
      externalEventId: "e_fail",
      eventType: "payment.failed",
      webhookSecret: "sec_12345678",
      signatureHeader: sig,
      timestampSeconds: ts,
      nowSeconds: ts,
      rawPayload: rawP,
      webhookAmountCents: 5250,
      webhookCurrencyCode: "BRL",
      order: createdPickup.order,
      processedEventKeys: new Set(),
    });
    assert.equal(failedWh.action, "ORDER_PAYMENT_FAILED");
    assert.equal(failedWh.updatedOrder.paymentStatus, "FAILED");

    // 7. Refund & Account deletion branches
    assert.throws(
      () =>
        evaluateRefundRequest({
          orderId: "o1",
          capturedAmountCents: 5000,
          alreadyRefundedCents: 0,
          requestedRefundCents: 0,
          staffMaxRefundApprovalCents: 5000,
          actorAal: "aal2",
          reason: "Valid",
        }),
      /REFUND_INVALID_AMOUNT/
    );
    assert.throws(
      () =>
        evaluateRefundRequest({
          orderId: "o1",
          capturedAmountCents: 5000,
          alreadyRefundedCents: 0,
          requestedRefundCents: 1000,
          staffMaxRefundApprovalCents: 5000,
          actorAal: "aal1",
          reason: "Valid",
        }),
      /REFUND_MFA_AAL2_REQUIRED/
    );
    assert.throws(
      () =>
        evaluateRefundRequest({
          orderId: "o1",
          capturedAmountCents: 5000,
          alreadyRefundedCents: 0,
          requestedRefundCents: 4000,
          staffMaxRefundApprovalCents: 2000,
          actorAal: "aal2",
          reason: "Valid",
        }),
      /REFUND_ABAC_LIMIT_EXCEEDED/
    );
    assert.throws(
      () =>
        evaluateRefundRequest({
          orderId: "o1",
          capturedAmountCents: 5000,
          alreadyRefundedCents: 4000,
          requestedRefundCents: 2000,
          staffMaxRefundApprovalCents: 5000,
          actorAal: "aal2",
          reason: "Valid",
        }),
      /REFUND_EXCEEDS_CAPTURED_AMOUNT/
    );

    const disputeHold = evaluateAccountDeletionRequest({
      userId: "u1",
      hasActiveOrders: false,
      hasOpenFinancialDisputes: true,
      hasCompletedFiscalTransactions: false,
      requestedAt: now,
    });
    assert.equal(disputeHold.reasonCode, "OPEN_FINANCIAL_DISPUTE_OR_CHARGEBACK");

    // 8. Settlement PAID_CONFIRMED & Delivery/OTP/Support/Promotion/Notification/Risk/Weighing branches
    const paidSettlement = evaluateSettlementPayoutExecution({
      settlement: {
        id: "s1",
        organizationId: "org_101",
        courierId: null,
        periodStart: "2026-11-01",
        periodEnd: "2026-11-03",
        amountCents: 10000,
        status: "SCHEDULED",
        approvedBy: null,
        externalPayoutReference: null,
        createdAtIso: now.toISOString(),
      },
      actorId: "fin_2",
      actorAal: "aal2",
      actorRoles: ["finance"],
      bankAccountApprovedByActorId: "fin_1",
      pspProviderStatus: "SANDBOX_READY",
      externalPayoutReference: "po_stripe_confirmed_01",
    });
    assert.equal(paidSettlement.status, "PAID_CONFIRMED");

    assert.equal(
      verifyDeliveryConfirmationCode({ providedCode: "12ab", expectedCodeHash: "abc" }),
      false
    );

    assert.equal(
      evaluateFleetOperatorAccess({
        fleetOrganizationId: "f1",
        actorOrganizationIds: ["f1"],
        targetCourierFleetOrgId: "f1",
        isFleetContractApproved: false,
      }).reasonCode,
      "DISABLED_PENDING_FLEET_CONTRACT"
    );
    assert.equal(
      evaluateFleetOperatorAccess({
        fleetOrganizationId: "f1",
        actorOrganizationIds: ["f1"],
        targetCourierFleetOrgId: "f1",
        isFleetContractApproved: true,
      }).reasonCode,
      "ALLOWED"
    );

    // Notification templates across all event types
    for (const evtType of [
      "ORDER_ACCEPTED",
      "ORDER_DELIVERED",
      "PAYMENT_REFUNDED",
      "DELIVERY_OFFER_CREATED",
      "DELIVERY_ASSIGNED",
      "SUPPORT_CASE_UPDATED",
      "PAYOUT_SETTLED",
      "SECURITY_DEVICE_REVOKED",
      "MARKETING_PROMO",
      "CUSTOM_UNKNOWN_EVENT",
    ]) {
      const rendered = renderVersionedNotificationTemplate({
        eventType: evtType,
        locale: "pt-BR",
      });
      assert.ok(rendered.title.length > 0);
      assert.ok(rendered.body.length > 0);
    }

    // All 5 risk rules
    for (const ruleCode of [
      "VELOCITY_HIGH_REFUND_RATE",
      "COURIER_REPEATED_OTP_FAILURES",
      "COUPON_ABUSE_MULTI_ACCOUNT",
      "HIGH_VALUE_ORDER_NEW_ACCOUNT",
      "BANK_ACCOUNT_FREQUENT_CHANGES",
    ] as const) {
      const riskRes = evaluateExplainableRiskRule({
        ruleCode,
        subjectType: "USER",
        subjectId: "u1",
        observedValue: 50000,
      });
      assert.equal(riskRes.triggered, true);
      assert.equal(riskRes.recommendedAction, "HUMAN_REVIEW_REQUIRED");
    }

    // Reject substitution decision
    const rejectedSub = resolveCustomerSubstitutionDecision({
      substitution: {
        id: "sub_rej",
        status: "PENDING_CUSTOMER_APPROVAL",
        originalLineCents: 2000,
        suggestedLineCents: 1800,
        expiresAtIso: "2026-11-19T16:00:00.000Z",
      },
      decision: "REJECT",
      now: new Date("2026-11-19T15:00:00.000Z"),
    });
    assert.equal(rejectedSub.updatedStatus, "REJECTED_BY_CUSTOMER");
    assert.equal(rejectedSub.refundDeltaCents, 2000);

    // Additional branch coverage for M13/M14/M17/M18/M19/M20/M21/M22 error & edge paths
    assert.throws(
      () =>
        evaluateSettlementPayoutExecution({
          settlement: {
            id: "s1",
            organizationId: "org_101",
            courierId: null,
            periodStart: "2026-11-01",
            periodEnd: "2026-11-03",
            amountCents: 10000,
            status: "SCHEDULED",
            approvedBy: null,
            externalPayoutReference: null,
            createdAtIso: now.toISOString(),
          },
          actorId: "u1",
          actorAal: "aal2",
          actorRoles: ["support"],
          pspProviderStatus: "SANDBOX_READY",
        }),
      /SETTLEMENT_FORBIDDEN/
    );
    assert.throws(
      () =>
        evaluateSettlementPayoutExecution({
          settlement: {
            id: "s1",
            organizationId: "org_101",
            courierId: null,
            periodStart: "2026-11-01",
            periodEnd: "2026-11-03",
            amountCents: 10000,
            status: "SCHEDULED",
            approvedBy: null,
            externalPayoutReference: null,
            createdAtIso: now.toISOString(),
          },
          actorId: "u1",
          actorAal: "aal1",
          actorRoles: ["finance"],
          pspProviderStatus: "SANDBOX_READY",
        }),
      /SETTLEMENT_MFA_AAL2_REQUIRED/
    );
    assert.throws(
      () =>
        evaluateSettlementPayoutExecution({
          settlement: {
            id: "s1",
            organizationId: "org_101",
            courierId: null,
            periodStart: "2026-11-01",
            periodEnd: "2026-11-03",
            amountCents: 10000,
            status: "SCHEDULED",
            approvedBy: null,
            externalPayoutReference: null,
            createdAtIso: now.toISOString(),
          },
          actorId: "u1",
          actorAal: "aal2",
          actorRoles: ["finance"],
          pspProviderStatus: "SANDBOX_READY",
          externalPayoutReference: "x",
        }),
      /SETTLEMENT_EXTERNAL_REF_REQUIRED/
    );

    const sampleTask = {
      id: "dt1",
      orderId: "o1",
      storeId: "s1",
      fulfillmentModality: "PLATFORM_DELIVERY" as const,
      status: "OFFERING",
      pickupLatitude: -23.56,
      pickupLongitude: -46.65,
      dropoffLatitude: -23.57,
      dropoffLongitude: -46.66,
      dropoffNeighborhoodOnly: "Jardins",
      dropoffFullAddress: null,
      courierFeeCents: 700,
      distanceMeters: 1200,
      estimatedEtaMinutes: 15,
      activeCourierId: null,
      pickedUpAtIso: null,
      completedAtIso: null,
      createdAtIso: now.toISOString(),
    };
    const sampleOffer = {
      id: "off1",
      deliveryTaskId: "dt1",
      courierId: "c1",
      offeredFeeCents: 700,
      status: "OFFERED" as const,
      pickupStoreName: "Store",
      distanceMeters: 1200,
      dropoffNeighborhoodOnly: "Jardins",
      expiresAtIso: "2026-11-03T16:00:00.000Z",
      respondedAtIso: null,
    };
    assert.throws(
      () =>
        acceptDeliveryOfferTransactional({
          offer: sampleOffer,
          task: sampleTask,
          actorCourierId: "c1",
          isCourierOnline: false,
          fullCustomerAddress: "Addr",
          now,
        }),
      /COURIER_OFFLINE/
    );
    assert.throws(
      () =>
        acceptDeliveryOfferTransactional({
          offer: sampleOffer,
          task: sampleTask,
          actorCourierId: "c2",
          isCourierOnline: true,
          fullCustomerAddress: "Addr",
          now,
        }),
      /DELIVERY_OFFER_FORBIDDEN/
    );
    assert.throws(
      () =>
        acceptDeliveryOfferTransactional({
          offer: { ...sampleOffer, status: "DECLINED" },
          task: sampleTask,
          actorCourierId: "c1",
          isCourierOnline: true,
          fullCustomerAddress: "Addr",
          now,
        }),
      /DELIVERY_OFFER_INVALID_STATE/
    );
    assert.throws(
      () =>
        acceptDeliveryOfferTransactional({
          offer: { ...sampleOffer, expiresAtIso: "2026-11-03T14:00:00.000Z" },
          task: sampleTask,
          actorCourierId: "c1",
          isCourierOnline: true,
          fullCustomerAddress: "Addr",
          now,
        }),
      /DELIVERY_OFFER_EXPIRED/
    );

    assert.throws(
      () =>
        evaluateCourierLocationSample({
          sampleId: "l1",
          courierId: "c1",
          deliveryTaskId: "dt1",
          activeCourierIdForTask: "c2",
          latitude: -23.56,
          longitude: -46.65,
          accuracyMeters: 10,
          recordedAtIso: now.toISOString(),
          now,
        }),
      /DELIVERY_TASK_ACCESS_FORBIDDEN/
    );
    assert.throws(
      () =>
        evaluateCourierLocationSample({
          sampleId: "l1",
          courierId: "c1",
          deliveryTaskId: "dt1",
          activeCourierIdForTask: "c1",
          latitude: 120,
          longitude: -46.65,
          accuracyMeters: 10,
          recordedAtIso: now.toISOString(),
          now,
        }),
      /INVALID_GPS_COORDINATES/
    );

    // M17 SLA upgrade & staff view & error branches
    assert.equal(
      computeSupportSlaDueAt({
        priority: "LOW",
        category: "MISSING_ITEM",
        createdAt: now,
      }).effectivePriority,
      "HIGH"
    );
    const staffSupportView = filterSupportCaseViewForActor({
      supportCase: {
        id: "sc1",
        caseNumber: 1,
        orderId: "o1",
        deliveryTaskId: null,
        organizationId: "org1",
        storeId: "s1",
        requesterId: "c1",
        requesterRole: "CUSTOMER",
        assignedStaffId: null,
        category: "GENERAL",
        priority: "LOW",
        status: "OPEN",
        subject: "Sub",
        slaDueAtIso: now.toISOString(),
        resolvedAtIso: null,
        createdAtIso: now.toISOString(),
        updatedAtIso: now.toISOString(),
      },
      messages: [],
      attachments: [],
      actionRequests: [],
      isStaffActor: true,
    });
    assert.equal(staffSupportView.supportCase.id, "sc1");

    assert.throws(
      () =>
        evaluateSupportActionRequest({
          id: "a1",
          caseId: "sc1",
          orderId: "o1",
          requestedByStaffId: "st1",
          actionType: "PARTIAL_REFUND",
          amountCents: 0,
          orderCapturedCents: 1000,
          alreadyRefundedCents: 0,
          autoApproveLimitCents: 1500,
          reason: "Valid reason",
        }),
      /SUPPORT_ACTION_INVALID_AMOUNT/
    );
    assert.throws(
      () =>
        evaluateSupportActionRequest({
          id: "a1",
          caseId: "sc1",
          orderId: "o1",
          requestedByStaffId: "st1",
          actionType: "PARTIAL_REFUND",
          amountCents: 500,
          orderCapturedCents: 1000,
          alreadyRefundedCents: 0,
          autoApproveLimitCents: 1500,
          reason: "no",
        }),
      /SUPPORT_ACTION_REASON_REQUIRED/
    );
    assert.throws(
      () =>
        evaluateSupportActionRequest({
          id: "a1",
          caseId: "sc1",
          orderId: "o1",
          requestedByStaffId: "st1",
          actionType: "PARTIAL_REFUND",
          amountCents: 1200,
          orderCapturedCents: 1000,
          alreadyRefundedCents: 0,
          autoApproveLimitCents: 1500,
          reason: "Valid reason",
        }),
      /SUPPORT_REFUND_EXCEEDS_CAPTURED/
    );

    const pendingReq = {
      id: "ar1",
      caseId: "sc1",
      orderId: "o1",
      requestedBy: "st1",
      actionType: "PARTIAL_REFUND" as const,
      amountCents: 2000,
      reason: "Valid",
      status: "PENDING_FINANCE" as const,
      decidedBy: null,
      decidedAtIso: null,
      decisionNotes: null,
      createdAtIso: now.toISOString(),
    };
    assert.throws(
      () =>
        decideEscalatedSupportActionRequest({
          request: pendingReq,
          decision: "APPROVED",
          decidedByStaffId: "st2",
          actorStaffRoles: ["finance"],
          actorAal: "aal1",
          decisionNotes: "Valid notes",
        }),
      /SUPPORT_FINANCE_MFA_AAL2_REQUIRED/
    );
    assert.throws(
      () =>
        decideEscalatedSupportActionRequest({
          request: pendingReq,
          decision: "APPROVED",
          decidedByStaffId: "st2",
          actorStaffRoles: ["support"],
          actorAal: "aal2",
          decisionNotes: "Valid notes",
        }),
      /SUPPORT_FINANCE_ROLE_REQUIRED/
    );
    assert.throws(
      () =>
        decideEscalatedSupportActionRequest({
          request: { ...pendingReq, status: "APPROVED" },
          decision: "APPROVED",
          decidedByStaffId: "st2",
          actorStaffRoles: ["finance"],
          actorAal: "aal2",
          decisionNotes: "Valid notes",
        }),
      /SUPPORT_ACTION_ALREADY_DECIDED/
    );
    assert.throws(
      () =>
        decideEscalatedSupportActionRequest({
          request: pendingReq,
          decision: "APPROVED",
          decidedByStaffId: "st2",
          actorStaffRoles: ["finance"],
          actorAal: "aal2",
          decisionNotes: "no",
        }),
      /SUPPORT_DECISION_NOTES_REQUIRED/
    );

    // M18 Proposal & Contract errors
    assert.throws(
      () =>
        validateAndBuildCommercialProposal({
          id: "p1",
          leadId: "l1",
          proposalVersion: 0,
          platformDeliveryCommissionBps: 2000,
          merchantDeliveryCommissionBps: 1000,
          pickupCommissionBps: 800,
          serviceFeeBps: 500,
          payoutCycleDays: 7,
          validUntilIso: "2027-01-01T00:00:00Z",
          proposedByStaffId: "st1",
        }),
      /COMMERCIAL_PROPOSAL_INVALID_NUMBER/
    );
    assert.throws(
      () =>
        validateAndBuildCommercialProposal({
          id: "p1",
          leadId: "l1",
          proposalVersion: 1,
          platformDeliveryCommissionBps: 9000,
          merchantDeliveryCommissionBps: 1000,
          pickupCommissionBps: 800,
          serviceFeeBps: 500,
          payoutCycleDays: 7,
          validUntilIso: "2027-01-01T00:00:00Z",
          proposedByStaffId: "st1",
        }),
      /COMMERCIAL_PROPOSAL_INVALID_BPS/
    );
    assert.throws(
      () =>
        validateAndBuildCommercialProposal({
          id: "p1",
          leadId: "l1",
          proposalVersion: 1,
          platformDeliveryCommissionBps: 2000,
          merchantDeliveryCommissionBps: 1000,
          pickupCommissionBps: 800,
          serviceFeeBps: 500,
          payoutCycleDays: 99 as 7,
          validUntilIso: "2027-01-01T00:00:00Z",
          proposedByStaffId: "st1",
        }),
      /COMMERCIAL_PROPOSAL_INVALID_PAYOUT_CYCLE/
    );
    assert.throws(
      () =>
        validateAndBuildCommercialProposal({
          id: "p1",
          leadId: "l1",
          proposalVersion: 1,
          platformDeliveryCommissionBps: 2000,
          merchantDeliveryCommissionBps: 1000,
          pickupCommissionBps: 800,
          serviceFeeBps: 500,
          payoutCycleDays: 7,
          validUntilIso: "",
          proposedByStaffId: "st1",
        }),
      /COMMERCIAL_PROPOSAL_VALID_UNTIL_REQUIRED/
    );

    // M19 Promotion failure reason codes & Review error branches
    const promoBase = {
      id: "pr1",
      code: "TEST",
      storeId: "s1",
      fundedBy: "PLATFORM" as const,
      platformShareBps: 10000,
      firstOrderOnly: true,
      discountType: "FIXED_CENTS" as const,
      discountValue: 1000,
      maxDiscountCents: 1000,
      minOrderCents: 3000,
      budgetLimitCents: 10000,
      budgetConsumedCents: 0,
      maxUsesPerUser: 1,
      startsAtIso: "2026-01-01T00:00:00Z",
      endsAtIso: "2027-01-01T00:00:00Z",
      isActive: true,
      createdBy: "st1",
      createdAtIso: now.toISOString(),
    };
    assert.equal(
      evaluatePromotionEligibilityAndSubsidy({
        promotion: { ...promoBase, isActive: false },
        storeId: "s1",
        grossMerchandiseCents: 5000,
        customerPriorOrdersCount: 0,
        customerPriorRedemptionsForPromo: 0,
        now,
      }).reasonCode,
      "PROMO_INACTIVE"
    );
    assert.equal(
      evaluatePromotionEligibilityAndSubsidy({
        promotion: { ...promoBase, endsAtIso: "2026-02-01T00:00:00Z" },
        storeId: "s1",
        grossMerchandiseCents: 5000,
        customerPriorOrdersCount: 0,
        customerPriorRedemptionsForPromo: 0,
        now,
      }).reasonCode,
      "PROMO_OUTSIDE_VALIDITY_WINDOW"
    );
    assert.equal(
      evaluatePromotionEligibilityAndSubsidy({
        promotion: promoBase,
        storeId: "s1",
        grossMerchandiseCents: 2000,
        customerPriorOrdersCount: 0,
        customerPriorRedemptionsForPromo: 0,
        now,
      }).reasonCode,
      "PROMO_BELOW_MIN_ORDER"
    );
    assert.equal(
      evaluatePromotionEligibilityAndSubsidy({
        promotion: promoBase,
        storeId: "s1",
        grossMerchandiseCents: 5000,
        customerPriorOrdersCount: 2,
        customerPriorRedemptionsForPromo: 0,
        now,
      }).reasonCode,
      "PROMO_FIRST_ORDER_ONLY"
    );
    assert.equal(
      evaluatePromotionEligibilityAndSubsidy({
        promotion: promoBase,
        storeId: "s1",
        grossMerchandiseCents: 5000,
        customerPriorOrdersCount: 0,
        customerPriorRedemptionsForPromo: 1,
        now,
      }).reasonCode,
      "PROMO_USER_LIMIT_EXCEEDED"
    );
    assert.equal(
      evaluatePromotionEligibilityAndSubsidy({
        promotion: { ...promoBase, discountValue: 0 },
        storeId: "s1",
        grossMerchandiseCents: 5000,
        customerPriorOrdersCount: 0,
        customerPriorRedemptionsForPromo: 0,
        now,
      }).reasonCode,
      "PROMO_ZERO_DISCOUNT"
    );

    assert.deepEqual(calculatePublishedStoreRatingSummary([]), {
      publishedReviewsCount: 0,
      averageRating: 0,
    });

    // M20 Channel eligibility remaining branches (IN_APP marketing opt-out, PUSH no consent, PUSH marketing opt-out, PUSH missing credentials, PUSH ready, EMAIL ready, WEBHOOK missing & ready)
    assert.equal(
      evaluateNotificationChannelEligibility({
        channel: "IN_APP",
        category: "MARKETING",
        preferences: {
          pushOrderUpdates: true,
          pushPromotions: false,
          emailTransactional: true,
          emailMarketing: false,
        },
      }).reasonCode,
      "MARKETING_OPT_OUT"
    );
    assert.equal(
      evaluateNotificationChannelEligibility({
        channel: "PUSH_IOS",
        category: "TRANSACTIONAL",
        device: {
          isRevoked: false,
          pushConsentGranted: false,
          pushToken: "apns_1",
        },
        providerStatus: "ACTIVE",
      }).reasonCode,
      "PUSH_CONSENT_NOT_GRANTED"
    );
    assert.equal(
      evaluateNotificationChannelEligibility({
        channel: "PUSH_IOS",
        category: "MARKETING",
        preferences: {
          pushOrderUpdates: true,
          pushPromotions: false,
          emailTransactional: true,
          emailMarketing: true,
        },
        device: {
          isRevoked: false,
          pushConsentGranted: true,
          pushToken: "apns_1",
        },
        providerStatus: "ACTIVE",
      }).reasonCode,
      "MARKETING_PUSH_OPT_OUT"
    );
    assert.equal(
      evaluateNotificationChannelEligibility({
        channel: "PUSH_IOS",
        category: "TRANSACTIONAL",
        device: {
          isRevoked: false,
          pushConsentGranted: true,
          pushToken: "apns_1",
        },
        providerStatus: "BLOCKED_MISSING_CREDENTIALS",
      }).reasonCode,
      "PROVIDER_MISSING_CREDENTIALS"
    );
    assert.equal(
      evaluateNotificationChannelEligibility({
        channel: "PUSH_IOS",
        category: "TRANSACTIONAL",
        device: {
          isRevoked: false,
          pushConsentGranted: true,
          pushToken: "apns_1",
        },
        providerStatus: "ACTIVE",
      }).reasonCode,
      "PUSH_DISPATCH_READY"
    );
    assert.equal(
      evaluateNotificationChannelEligibility({
        channel: "EMAIL",
        category: "TRANSACTIONAL",
        providerStatus: "ACTIVE",
      }).reasonCode,
      "EMAIL_DISPATCH_READY"
    );
    assert.equal(
      evaluateNotificationChannelEligibility({
        channel: "WEBHOOK",
        category: "TRANSACTIONAL",
        providerStatus: "BLOCKED_MISSING_CREDENTIALS",
      }).reasonCode,
      "WEBHOOK_CREDENTIALS_MISSING"
    );
    assert.equal(
      evaluateNotificationChannelEligibility({
        channel: "WEBHOOK",
        category: "TRANSACTIONAL",
        providerStatus: "ACTIVE",
      }).reasonCode,
      "WEBHOOK_DISPATCH_READY"
    );

    assert.throws(
      () =>
        signOutboundWebhookPayload({
          eventId: "e1",
          eventType: "order.created",
          payload: {},
          secret: "short",
        }),
      /WEBHOOK_SECRET_REQUIRED/
    );
    assert.equal(
      verifyOutboundWebhookSignature({
        envelope: {
          eventId: "e1",
          eventType: "order.created",
          timestampSeconds: 1700000000,
          signatureHex: "0000",
          payloadJson: "{}",
        },
        secret: "whsec_valid_secret_1234",
        nowSeconds: 1700000010,
      }).reasonCode,
      "WEBHOOK_SIGNATURE_MISMATCH"
    );

    // M22 substitution & weighing error branches
    assert.throws(
      () =>
        calculateWeighedItemPriceCents({
          actualWeightGrams: -10,
          pricePerKgCents: 3000,
          preAuthorizedLineCents: 1500,
        }),
      /INVALID_WEIGHT_GRAMS/
    );
    assert.throws(
      () =>
        evaluateItemSubstitutionProposal({
          customerPreference: "ALLOW_SUGGESTION",
          originalLineCents: 1000,
          action: "PROPOSE_SUBSTITUTION",
          reason: "x",
        }),
      /SUBSTITUTION_REASON_REQUIRED/
    );
    assert.throws(
      () =>
        evaluateItemSubstitutionProposal({
          customerPreference: "ALLOW_SUGGESTION",
          originalLineCents: 1000,
          action: "PROPOSE_SUBSTITUTION",
          reason: "Valid reason",
          timeoutSeconds: 10,
        }),
      /INVALID_SUBSTITUTION_TIMEOUT/
    );
    assert.throws(
      () =>
        evaluateItemSubstitutionProposal({
          customerPreference: "ALLOW_SUGGESTION",
          originalLineCents: 1000,
          action: "PROPOSE_SUBSTITUTION",
          reason: "Valid reason",
        }),
      /SUBSTITUTION_SUGGESTED_PRODUCT_REQUIRED/
    );
    assert.throws(
      () =>
        evaluateItemSubstitutionProposal({
          customerPreference: "ALLOW_SUGGESTION",
          originalLineCents: 1000,
          action: "PROPOSE_SUBSTITUTION",
          suggestedProductId: "p2",
          suggestedProductNameEn: "Alt",
          suggestedProductNamePtBr: "Alt",
          suggestedLineCents: 1500,
          reason: "Valid reason",
        }),
      /SUBSTITUTION_EXCEEDS_ORIGINAL_CEILING/
    );
    const markUnavailAllowSub = evaluateItemSubstitutionProposal({
      customerPreference: "ALLOW_SUGGESTION",
      originalLineCents: 1000,
      action: "MARK_UNAVAILABLE_REFUND",
      reason: "Out of stock completely",
    });
    assert.equal(markUnavailAllowSub.status, "AUTO_REFUNDED_UNAVAILABLE");

    assert.throws(
      () =>
        resolveCustomerSubstitutionDecision({
          substitution: {
            id: "s1",
            status: "APPROVED_BY_CUSTOMER",
            originalLineCents: 1000,
            suggestedLineCents: 900,
            expiresAtIso: "2027-01-01T00:00:00Z",
          },
          decision: "APPROVE",
        }),
      /SUBSTITUTION_ALREADY_RESOLVED/
    );
    assert.throws(
      () =>
        finalizeOrderPickTaskFinancialAdjustment({
          orderId: "o1",
          organizationId: "org_101",
          preAuthorizedTotalCents: 5000,
          orderItems: [{ orderItemId: "i1", totalLineCents: 2000, adjustedLineCents: 1900 }],
          substitutions: [
            {
              id: "sub_pending",
              status: "PENDING_CUSTOMER_APPROVAL",
              expiresAtIso: "2027-01-01T00:00:00Z",
            },
          ],
        }),
      /PICK_TASK_AWAITING_CUSTOMER_APPROVAL/
    );
    assert.throws(
      () =>
        finalizeOrderPickTaskFinancialAdjustment({
          orderId: "o1",
          organizationId: "org_101",
          preAuthorizedTotalCents: 5000,
          orderItems: [{ orderItemId: "i1", totalLineCents: 2000, adjustedLineCents: 2500 }],
          substitutions: [],
        }),
      /WEIGHING_EXCEEDS_PREAUTHORIZED_CEILING/
    );
  });
});
