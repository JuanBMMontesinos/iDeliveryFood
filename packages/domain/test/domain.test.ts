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
});
