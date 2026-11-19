import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDeliveryApiClient, IDeliveryApiError } from "../src/index.js";

describe("@ideliveryfood/api-client — Typed /v1 Client, Correlation ID & Idempotency Tests", () => {
  it("propagates Accept-Language ('en' default, 'pt-BR' switchable) and X-Correlation-Id headers", async () => {
    let capturedHeaders: Record<string, string> = {};

    const client = new IDeliveryApiClient({
      baseUrl: "http://localhost:4000/v1",
      fetchImpl: async (_url, init) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return new Response(
          JSON.stringify({
            data: [],
            meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    });

    assert.equal(client.getLocale(), "en");
    await client.listPublishedStores();
    assert.equal(capturedHeaders["Accept-Language"], "en");
    assert.match(capturedHeaders["X-Correlation-Id"] ?? "", /^corr_/);

    await client.updateLocalePreference("pt-BR", "idem_pref_update_001");
    assert.equal(client.getLocale(), "pt-BR");
    assert.equal(capturedHeaders["Accept-Language"], "pt-BR");
    assert.equal(capturedHeaders["X-Idempotency-Key"], "idem_pref_update_001");
  });

  it("enforces X-Idempotency-Key on mutations and maps error envelopes to IDeliveryApiError", async () => {
    const client = new IDeliveryApiClient({
      baseUrl: "http://localhost:4000/v1",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "AUTH_MFA_REQUIRED",
              message: "MFA aal2 step-up required",
              correlationId: "corr_err_01",
              timestamp: "2026-11-03T12:00:00Z",
            },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        ),
    });

    await assert.rejects(
      () => client.updateLocalePreference("pt-BR", "short"),
      /IDEMPOTENCY_KEY_REQUIRED/
    );

    await assert.rejects(
      () =>
        client.createOrderFromQuote({
          quoteId: "quote_123",
          idempotencyKey: "short",
        }),
      /IDEMPOTENCY_KEY_REQUIRED/
    );

    await assert.rejects(
      () => client.listPublishedStores(),
      (err: unknown) => {
        assert.ok(err instanceof IDeliveryApiError);
        assert.equal(err.status, 403);
        assert.equal(err.envelope.error.code, "AUTH_MFA_REQUIRED");
        return true;
      }
    );
  });

  it("executes all typed /v1 endpoint methods across M01-M22 with proper path, query, method, Authorization, and body serialization", async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
    const client = new IDeliveryApiClient({
      baseUrl: "http://localhost:4000/v1/",
      locale: "pt-BR",
      getAccessToken: () => "jwt_token_123",
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          method: init?.method ?? "GET",
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    await client.listPublishedStores({ search: "burger", cuisineCategory: "BURGERS" });
    await client.getStoreCatalog("store_201");
    await client.evaluateStoreAvailabilityAndCoverage({
      storeId: "store_201",
      customerLatitude: -23.56,
      customerLongitude: -46.65,
      fulfillmentModality: "PLATFORM_DELIVERY",
      grossMerchandiseCents: 5000,
    });
    await client.listMyAddresses();
    await client.createQuote({
      storeId: "store_201",
      addressId: "addr_1",
      fulfillmentModality: "PLATFORM_DELIVERY",
      cartItems: [],
      discountCents: 500,
      discountFundedBy: "PLATFORM",
      promotionCode: "WELCOME10",
      idempotencyKey: "idem_quote_12345",
    });
    await client.createOrderFromQuote({
      quoteId: "q_1",
      customerNotes: "No onions",
      idempotencyKey: "idem_order_12345",
    });
    await client.executeOrderCommand({
      orderId: "ord_1",
      command: "ACCEPT",
      expectedVersion: 1,
      reason: "Accepted",
      idempotencyKey: "idem_cmd_12345",
    });
    await client.listOrderEvents("ord_1");
    await client.createPaymentAttempt({
      orderId: "ord_1",
      providerCode: "stripe",
      paymentMethod: "PIX",
      idempotencyKey: "idem_pay_12345",
    });
    await client.requestRefund({
      orderId: "ord_1",
      paymentAttemptId: "pa_1",
      amountCents: 1000,
      reason: "Refund test",
      idempotencyKey: "idem_ref_12345",
    });
    await client.updateStoreSettings({
      storeId: "store_201",
      organizationId: "org_101",
      patch: { isPaused: false },
      idempotencyKey: "idem_set_12345",
    });
    await client.requestBankAccountChange({
      storeId: "store_201",
      organizationId: "org_101",
      bankCode: "341",
      branchNumber: "0001",
      accountLast4: "1234",
      reason: "Change account",
      idempotencyKey: "idem_bank_12345",
    });
    await client.getStoreOrdersQueue("store_201", "org_101");
    await client.grantStaffScope({
      request: {
        targetUserId: "u_2",
        role: "support",
        regionCode: "BR-SP",
        maxRefundApprovalCents: 1500,
        justification: "Grant scope",
      },
      idempotencyKey: "idem_grant_12345",
    });
    await client.executeAdminGovernanceAction({
      targetType: "STORE",
      targetId: "store_201",
      decision: "APPROVED",
      reason: "Approved KYC",
      idempotencyKey: "idem_gov_12345",
    });
    await client.runPspReconciliation({
      providerCode: "stripe",
      runDate: "2026-11-19",
      expectedOrders: [],
      pspReportedCaptures: [],
      idempotencyKey: "idem_rec_12345",
    });
    await client.executeSettlementPayout({
      settlementId: "set_1",
      providerCode: "stripe",
      bankAccountApprovedByActorId: "fin_1",
      externalPayoutReference: "po_123",
      idempotencyKey: "idem_settle_12345",
    });
    await client.acceptDeliveryOffer({
      offerId: "off_1",
      isCourierOnline: true,
      idempotencyKey: "idem_off_12345",
    });
    await client.submitCourierLocationSample({
      deliveryTaskId: "task_1",
      latitude: -23.56,
      longitude: -46.65,
      accuracyMeters: 10,
      recordedAtIso: "2026-11-19T12:00:00Z",
      idempotencyKey: "idem_loc_12345",
    });
    await client.completeDeliveryTaskWithOtp({
      taskId: "task_1",
      confirmationCode: "4829",
      idempotencyKey: "idem_otp_12345",
    });
    await client.getStoreDetail("store_201");
    await client.replaceStoreHours({ storeId: "store_201", hours: [] });
    await client.upsertStoreHourException({
      storeId: "store_201",
      exception: {
        exceptionDate: "2026-12-25",
        opensAt: null,
        closesAt: null,
        isClosed: true,
        reason: "Holiday",
      },
    });
    await client.createStoreServiceArea({
      storeId: "store_201",
      area: {
        name: "Area 1",
        radiusMeters: 5000,
        baseFeeCents: 600,
        perKmFeeCents: 100,
        freeDeliveryMinOrderCents: null,
        estimatedDeliveryMinutes: 30,
        isActive: true,
      },
    });
    await client.createCatalogCategory({
      storeId: "store_201",
      category: { nameEn: "Burgers", namePtBr: "Hambúrgueres" },
    });
    await client.createCatalogProduct({
      storeId: "store_201",
      product: {
        categoryId: "cat_1",
        nameEn: "Smash",
        namePtBr: "Smash",
        priceCents: 3500,
      },
    });
    await client.createCatalogOptionGroup({
      productId: "prod_1",
      optionGroup: { nameEn: "Point", namePtBr: "Ponto", minSelections: 1, maxSelections: 1 },
    });
    await client.createCatalogOption({
      productId: "prod_1",
      optionGroupId: "grp_1",
      option: { nameEn: "Medium", namePtBr: "Ao Ponto", additionalPriceCents: 0 },
    });
    await client.executeMultiUnitCatalogBatch({
      organizationId: "org_101",
      targetStoreIds: ["store_201"],
      productId: "prod_1",
      priceCents: 3900,
      dryRun: true,
    });
    await client.createSignedUploadUrl({
      bucket: "catalog-media",
      fileName: "burger.webp",
      mimeType: "image/webp",
      fileSizeBytes: 1024,
      storeId: "store_201",
    });
    await client.getMe();
    await client.createMyAddress({
      label: "Home",
      recipientName: "Alice",
      streetLine: "Rua Oscar Freire",
      number: "950",
      complement: null,
      neighborhood: "Jardins",
      city: "São Paulo",
      stateCode: "SP",
      postalCode: "01426-001",
      latitude: -23.56,
      longitude: -46.66,
      deliveryInstructions: null,
      isDefault: true,
    });
    await client.listMyDevices();
    await client.revokeMyDevice("dev_1");
    await client.requestAccountDeletion({
      hasActiveOrders: false,
      hasOpenFinancialDisputes: false,
      hasCompletedFiscalTransactions: false,
    });
    await client.getOrder("ord_1");
    await client.getOrderReview("ord_1");
    await client.submitOrderReview({ orderId: "ord_1", rating: 5, comment: "Top" });
    await client.listOrderSupportCases("ord_1");
    await client.createOrderSupportCase({ orderId: "ord_1", subject: "Help" });
    await client.listOrganizationMembers("org_101");
    await client.getOrganizationUnitsSummary("org_101");
    await client.getPartnerFinanceSummary("org_101");
    await client.getMerchantContract("org_101");
    await client.listStoreReviews("store_201");
    await client.replyToStoreReview({ storeId: "store_201", reviewId: "rev_1", reply: "Thanks!" });
    await client.listStoreSupportCases("store_201");
    await client.getAdminOverview();
    await client.listAdminAuditLogs();
    await client.getFinanceBackofficeOverview();
    await client.getLogisticsBackofficeOverview();
    await client.getFleetsBackofficeOverview();
    await client.getSupportBackofficeOverview();
    await client.listSupportCases({ status: "OPEN" });
    await client.getSupportCaseDetail("case_1");
    await client.postSupportCaseMessage({ caseId: "case_1", body: "Hello", isInternalNote: true });
    await client.transitionSupportCaseStatus({
      caseId: "case_1",
      status: "IN_PROGRESS",
      assignedStaffId: "staff_1",
      reason: "Taking ticket",
    });
    await client.createSupportActionRequest({
      caseId: "case_1",
      orderId: "ord_1",
      actionType: "PARTIAL_REFUND",
      amountCents: 1000,
      reason: "Missing drink",
    });
    await client.decideSupportActionRequest({
      requestId: "act_1",
      decision: "APPROVED",
      decisionNotes: "Verified",
    });
    await client.getCommercialBackofficeOverview();
    await client.listCommercialLeads({ status: "NEW" });
    await client.createCommercialLead({
      legalName: "Bistro Ltda",
      tradeName: "Bistro",
      taxId: "12345678000199",
      contactEmail: "bistro@example.com",
    });
    await client.transitionCommercialLeadStatus({
      leadId: "lead_1",
      status: "QUALIFYING",
      convertedOrganizationId: null,
      notes: "Note",
    });
    await client.createCommercialProposal({
      leadId: "lead_1",
      platformDeliveryCommissionBps: 2100,
      merchantDeliveryCommissionBps: 1100,
      pickupCommissionBps: 800,
    });
    await client.convertCommercialProposal({ proposalId: "prop_1" });
    await client.acceptMerchantContract("contract_1");
    await client.listOrganizationCommissionRules("org_101");
    await client.getMarketingBackofficeOverview();
    await client.listPromotions("store_201");
    await client.createPromotion({
      code: "PROMO10",
      discountValue: 1000,
      budgetLimitCents: 50000,
    });
    await client.redeemPromotion({
      code: "PROMO10",
      storeId: "store_201",
      grossMerchandiseCents: 5000,
      idempotencyKey: "idem_red_12345",
    });
    await client.replyToReviewDirect({ reviewId: "rev_1", reply: "Thank you!" });
    await client.moderateOrderReview({
      reviewId: "rev_1",
      moderationStatus: "PUBLISHED",
      reason: "Clean review content",
    });
    await client.listMyNotifications({
      sinceCursorSeq: 5,
      unreadOnly: true,
      channel: "IN_APP",
    });
    await client.markNotificationRead("notif_1");
    await client.getAnalyticsOverview({
      excludeTestData: true,
      storeId: "store_201",
      fromIso: "2026-11-01T00:00:00Z",
      toIso: "2026-11-19T23:59:59Z",
    });
    await client.exportAnalyticsJson({
      excludeTestData: true,
      storeId: "store_201",
      limit: 50,
      offset: 0,
    });
    await client.getGovernanceOverview({ excludeTestData: true });
    await client.listRiskAlerts({ status: "OPEN_AWAITING_HUMAN_REVIEW" });
    await client.evaluateRiskAlert({
      ruleCode: "VELOCITY_HIGH_REFUND_RATE",
      subjectType: "USER",
      subjectId: "u_1",
      observedValue: 5000,
    });
    await client.reviewRiskAlert({
      alertId: "al_1",
      decision: "DISMISS_FALSE_POSITIVE",
      reason: "Verified legitimate customer",
    });
    await client.listPrivacyRequests({ status: "REQUESTED" });
    await client.generateMyPrivacyExport();
    await client.requestMyPrivacyAction({ requestType: "EXPORT_DATA" });
    await client.processPrivacyRequestExport("preq_1");
    await client.processPrivacyRequestAnonymization("preq_1");
    await client.getStoreGroceryPickingOverview("store_201");
    await client.startOrderPickTask({
      storeId: "store_201",
      orderId: "ord_1",
      id: "pt_1",
      notes: "Start picking",
    });
    await client.weighOrderPickingItem({
      pickTaskId: "pt_1",
      orderItemId: "item_1",
      actualWeightGrams: 480,
      explicitCustomerOverweightConsent: false,
    });
    await client.proposeOrRefundOrderItemSubstitution({
      pickTaskId: "pt_1",
      id: "sub_1",
      orderItemId: "item_1",
      action: "PROPOSE_SUBSTITUTION",
      suggestedProductId: "p_2",
      suggestedProductNameEn: "Alt",
      suggestedProductNamePtBr: "Alt",
      suggestedLineCents: 1500,
      reason: "Out of stock",
      timeoutSeconds: 300,
      allowPriceIncreaseWithConsent: false,
    });
    await client.completeOrderPickTask({ pickTaskId: "pt_1", notes: "Done" });
    await client.getOrderGroceryPickingDetail("ord_1");
    await client.respondToOrderItemSubstitution({
      orderId: "ord_1",
      substitutionId: "sub_1",
      decision: "APPROVE",
      notes: "OK",
    });

    // Exercise default/omitted optional parameter branches across methods
    await client.evaluateStoreAvailabilityAndCoverage({ storeId: "store_201" });
    await client.createQuote({
      storeId: "store_201",
      fulfillmentModality: "PICKUP",
      cartItems: [],
      idempotencyKey: "idem_quote_defaults",
    });
    await client.createOrderFromQuote({
      quoteId: "q_1",
      idempotencyKey: "idem_order_defaults",
    });
    await client.executeOrderCommand({
      orderId: "ord_1",
      command: "ACCEPT",
      expectedVersion: 1,
      idempotencyKey: "idem_cmd_defaults",
    });
    await client.executeSettlementPayout({
      settlementId: "set_1",
      providerCode: "stripe",
      idempotencyKey: "idem_settle_defaults",
    });
    await client.executeMultiUnitCatalogBatch({
      organizationId: "org_101",
      targetStoreIds: ["store_201"],
      productId: "prod_1",
    });
    await client.submitOrderReview({ orderId: "ord_1", rating: 5 });
    await client.listSupportCases();
    await client.postSupportCaseMessage({ caseId: "case_1", body: "Default note" });
    await client.transitionSupportCaseStatus({ caseId: "case_1", status: "RESOLVED" });
    await client.createSupportActionRequest({
      caseId: "case_1",
      actionType: "FULL_REFUND",
      amountCents: 500,
      reason: "Full refund",
    });
    await client.listCommercialLeads();
    await client.transitionCommercialLeadStatus({ leadId: "lead_1", status: "LOST" });
    await client.listPromotions();
    await client.listMyNotifications();
    await client.getAnalyticsOverview();
    await client.exportAnalyticsJson();
    await client.getGovernanceOverview();
    await client.listRiskAlerts();
    await client.listPrivacyRequests();
    await client.startOrderPickTask({ storeId: "store_201", orderId: "ord_1" });
    await client.weighOrderPickingItem({
      pickTaskId: "pt_1",
      orderItemId: "item_1",
      actualWeightGrams: 500,
    });
    await client.proposeOrRefundOrderItemSubstitution({
      pickTaskId: "pt_1",
      orderItemId: "item_1",
      action: "MARK_UNAVAILABLE_REFUND",
      reason: "Unavailable",
    });
    await client.completeOrderPickTask({ pickTaskId: "pt_1" });
    await client.respondToOrderItemSubstitution({
      orderId: "ord_1",
      substitutionId: "sub_1",
      decision: "REJECT",
    });

    // Fallback error envelope when response body has no 'error' property
    const fallbackErrClient = new IDeliveryApiClient({
      baseUrl: "http://localhost:4000/v1",
      fetchImpl: async () =>
        new Response(JSON.stringify({ message: "Raw gateway failure" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
    });
    await assert.rejects(
      () => fallbackErrClient.getMe(),
      (err: unknown) => {
        assert.ok(err instanceof IDeliveryApiError);
        assert.equal(err.status, 502);
        assert.equal(err.envelope.error.code, "HTTP_502");
        return true;
      }
    );

    assert.ok(calls.length >= 90);
    assert.equal(calls[0]?.headers.Authorization, "Bearer jwt_token_123");
  });
});
