import {
  DEFAULT_LOCALE,
  type AdminGovernanceActionContract,
  type AdminStaffScopeGrantRequestContract,
  type ApiErrorEnvelope,
  type AuthenticatedActorProfileContract,
  type BankAccountChangeRequestContract,
  type BatchCatalogUpdateItemResultContract,
  type CartItemSelectionContract,
  type CatalogCategoryContract,
  type CatalogCategoryUpsertContract,
  type CatalogOptionContract,
  type CatalogOptionGroupContract,
  type CatalogOptionGroupUpsertContract,
  type CatalogOptionUpsertContract,
  type CatalogProductContract,
  type CatalogProductUpsertContract,
  type CourierLocationSampleContract,
  type CustomerAddressContract,
  type DeliveryOfferContract,
  type DeliveryTaskContract,
  type FulfillmentModality,
  type OrderEventRecordContract,
  type OrderRecordContract,
  type OrderReviewContract,
  type PaginatedResponse,
  type PaymentAttemptContract,
  type PaymentMethodCode,
  type PspReconciliationRunContract,
  type PublishedStoreContract,
  type RefundRecordContract,
  type ServerQuoteRecordContract,
  type SettlementRecordContract,
  type ServiceAreaEligibilityContract,
  type SignedUploadUrlRequestContract,
  type SignedUploadUrlResponseContract,
  type StoreAvailabilityEvaluationContract,
  type StoreCatalogResponseContract,
  type StoreDetailResponseContract,
  type StoreHourExceptionContract,
  type StoreOperatingHourContract,
  type StoreOrdersQueueResponseContract,
  type StoreServiceAreaContract,
  type StoreSettingsPatchContract,
  type SupportCaseContract,
  type SupportedLocale,
  type UserDeviceContract,
  type UserPreferencesContract,
} from "@ideliveryfood/contracts";

export interface ApiClientOptions {
  baseUrl: string;
  locale?: SupportedLocale;
  getAccessToken?: () => Promise<string | null> | string | null;
  fetchImpl?: typeof fetch;
}

export class IDeliveryApiError extends Error {
  public readonly status: number;
  public readonly envelope: ApiErrorEnvelope;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.error.message);
    this.name = "IDeliveryApiError";
    this.status = status;
    this.envelope = envelope;
  }
}

export class IDeliveryApiClient {
  private readonly baseUrl: string;
  private locale: SupportedLocale;
  private readonly getAccessToken: (() => Promise<string | null> | string | null) | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.locale = options.locale ?? DEFAULT_LOCALE;
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  public setLocale(locale: SupportedLocale): void {
    this.locale = locale;
  }

  public getLocale(): SupportedLocale {
    return this.locale;
  }

  public async request<T>(params: {
    path: string;
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    correlationId?: string;
    idempotencyKey?: string;
    requireIdempotency?: boolean;
  }): Promise<T> {
    if (params.requireIdempotency && (!params.idempotencyKey || params.idempotencyKey.trim().length < 8)) {
      throw new Error("IDEMPOTENCY_KEY_REQUIRED: Mutation requires a valid X-Idempotency-Key header.");
    }

    const correlationId = params.correlationId ?? `corr_${Date.now()}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Accept-Language": this.locale,
      "X-Correlation-Id": correlationId,
    };

    if (params.idempotencyKey) {
      headers["X-Idempotency-Key"] = params.idempotencyKey;
    }

    if (this.getAccessToken) {
      const token = await this.getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    const init: RequestInit = {
      method: params.method ?? "GET",
      headers,
    };

    if (params.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(params.body);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${params.path}`, init);
    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      const fallbackEnvelope: ApiErrorEnvelope =
        payload && typeof payload === "object" && "error" in payload
          ? (payload as ApiErrorEnvelope)
          : {
              error: {
                code: `HTTP_${response.status}`,
                message: `Request failed with status ${response.status}`,
                correlationId,
                timestamp: new Date().toISOString(),
              },
            };
      throw new IDeliveryApiError(response.status, fallbackEnvelope);
    }

    return payload as T;
  }

  public async listPublishedStores(params?: {
    search?: string;
    cuisineCategory?: string;
  }): Promise<PaginatedResponse<PublishedStoreContract>> {
    const query = new URLSearchParams({ locale: this.locale });
    if (params?.search) query.set("search", params.search);
    if (params?.cuisineCategory) query.set("cuisineCategory", params.cuisineCategory);
    return this.request<PaginatedResponse<PublishedStoreContract>>({
      path: `/stores?${query.toString()}`,
      method: "GET",
    });
  }

  public async getStoreCatalog(
    storeId: string
  ): Promise<{ data: StoreCatalogResponseContract }> {
    return this.request<{ data: StoreCatalogResponseContract }>({
      path: `/stores/${encodeURIComponent(storeId)}/catalog?locale=${encodeURIComponent(this.locale)}`,
      method: "GET",
    });
  }

  public async evaluateStoreAvailabilityAndCoverage(params: {
    storeId: string;
    customerLatitude?: number;
    customerLongitude?: number;
    fulfillmentModality?: FulfillmentModality;
    grossMerchandiseCents?: number;
  }): Promise<{
    data: {
      availability: StoreAvailabilityEvaluationContract;
      coverage: ServiceAreaEligibilityContract | null;
    };
  }> {
    const query = new URLSearchParams();
    if (params.customerLatitude !== undefined) {
      query.set("lat", String(params.customerLatitude));
    }
    if (params.customerLongitude !== undefined) {
      query.set("lng", String(params.customerLongitude));
    }
    if (params.fulfillmentModality) {
      query.set("modality", params.fulfillmentModality);
    }
    if (params.grossMerchandiseCents !== undefined) {
      query.set("basketCents", String(params.grossMerchandiseCents));
    }
    const qs = query.toString();
    return this.request({
      path: `/stores/${encodeURIComponent(params.storeId)}/availability${qs ? `?${qs}` : ""}`,
      method: "GET",
    });
  }

  public async listMyAddresses(): Promise<{ data: CustomerAddressContract[] }> {
    return this.request<{ data: CustomerAddressContract[] }>({
      path: "/me/addresses",
      method: "GET",
    });
  }

  public async createQuote(params: {
    storeId: string;
    addressId?: string | null;
    fulfillmentModality: FulfillmentModality;
    cartItems: CartItemSelectionContract[];
    discountCents?: number;
    discountFundedBy?: "PLATFORM" | "MERCHANT" | "NONE";
    promotionCode?: string | null;
    idempotencyKey: string;
  }): Promise<{ data: ServerQuoteRecordContract }> {
    return this.request<{ data: ServerQuoteRecordContract }>({
      path: "/quotes",
      method: "POST",
      body: {
        storeId: params.storeId,
        addressId: params.addressId ?? null,
        fulfillmentModality: params.fulfillmentModality,
        cartItems: params.cartItems,
        discountCents: params.discountCents ?? 0,
        discountFundedBy: params.discountFundedBy ?? "NONE",
        promotionCode: params.promotionCode ?? null,
      },
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async createOrderFromQuote(params: {
    quoteId: string;
    customerNotes?: string | null;
    idempotencyKey: string;
  }): Promise<{ data: OrderRecordContract }> {
    return this.request<{ data: OrderRecordContract }>({
      path: "/orders",
      method: "POST",
      body: {
        quoteId: params.quoteId,
        customerNotes: params.customerNotes ?? null,
      },
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async executeOrderCommand(params: {
    orderId: string;
    command: string;
    expectedVersion: number;
    reason?: string;
    idempotencyKey: string;
  }): Promise<{ data: { order: OrderRecordContract; event: OrderEventRecordContract } }> {
    return this.request<{ data: { order: OrderRecordContract; event: OrderEventRecordContract } }>({
      path: `/orders/${encodeURIComponent(params.orderId)}/commands`,
      method: "POST",
      body: {
        command: params.command,
        expectedVersion: params.expectedVersion,
        reason: params.reason ?? null,
      },
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async listOrderEvents(
    orderId: string
  ): Promise<{ data: OrderEventRecordContract[] }> {
    return this.request<{ data: OrderEventRecordContract[] }>({
      path: `/orders/${encodeURIComponent(orderId)}/events`,
      method: "GET",
    });
  }

  public async createPaymentAttempt(params: {
    orderId: string;
    providerCode: string;
    paymentMethod: PaymentMethodCode;
    idempotencyKey: string;
  }): Promise<{ data: PaymentAttemptContract }> {
    return this.request<{ data: PaymentAttemptContract }>({
      path: "/payments/attempts",
      method: "POST",
      body: {
        orderId: params.orderId,
        providerCode: params.providerCode,
        paymentMethod: params.paymentMethod,
      },
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async requestRefund(params: {
    orderId: string;
    paymentAttemptId: string;
    amountCents: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ data: RefundRecordContract }> {
    return this.request<{ data: RefundRecordContract }>({
      path: "/refunds",
      method: "POST",
      body: {
        orderId: params.orderId,
        paymentAttemptId: params.paymentAttemptId,
        amountCents: params.amountCents,
        reason: params.reason,
      },
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async updateLocalePreference(
    locale: SupportedLocale,
    idempotencyKey: string
  ): Promise<UserPreferencesContract> {
    this.setLocale(locale);
    return this.request<UserPreferencesContract>({
      path: "/me/preferences",
      method: "PATCH",
      body: { locale },
      idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async updateStoreSettings(params: {
    storeId: string;
    organizationId: string;
    patch: StoreSettingsPatchContract;
    idempotencyKey: string;
  }): Promise<{ data: PublishedStoreContract }> {
    return this.request<{ data: PublishedStoreContract }>({
      path: `/stores/${encodeURIComponent(params.storeId)}/settings`,
      method: "PATCH",
      body: {
        organizationId: params.organizationId,
        ...params.patch,
      },
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async requestBankAccountChange(params: {
    storeId: string;
    organizationId: string;
    bankCode: string;
    branchNumber: string;
    accountLast4: string;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ data: BankAccountChangeRequestContract }> {
    return this.request<{ data: BankAccountChangeRequestContract }>({
      path: `/stores/${encodeURIComponent(params.storeId)}/bank-account-change-request`,
      method: "POST",
      body: {
        organizationId: params.organizationId,
        bankCode: params.bankCode,
        branchNumber: params.branchNumber,
        accountLast4: params.accountLast4,
        reason: params.reason,
      },
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async getStoreOrdersQueue(
    storeId: string,
    organizationId: string
  ): Promise<{ data: StoreOrdersQueueResponseContract }> {
    const query = new URLSearchParams({ organizationId });
    return this.request<{ data: StoreOrdersQueueResponseContract }>({
      path: `/stores/${encodeURIComponent(storeId)}/orders-queue?${query.toString()}`,
      method: "GET",
    });
  }

  public async grantStaffScope(params: {
    request: AdminStaffScopeGrantRequestContract;
    idempotencyKey: string;
  }): Promise<{ data: AdminStaffScopeGrantRequestContract & { grantedBy: string } }> {
    return this.request<{ data: AdminStaffScopeGrantRequestContract & { grantedBy: string } }>({
      path: "/admin/staff-scopes",
      method: "POST",
      body: params.request,
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async executeAdminGovernanceAction(params: {
    targetType: AdminGovernanceActionContract["targetType"];
    targetId: string;
    decision: AdminGovernanceActionContract["decision"];
    reason: string;
    idempotencyKey: string;
  }): Promise<{ data: AdminGovernanceActionContract }> {
    return this.request<{ data: AdminGovernanceActionContract }>({
      path: "/admin/governance-actions",
      method: "POST",
      body: {
        targetType: params.targetType,
        targetId: params.targetId,
        decision: params.decision,
        reason: params.reason,
      },
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async runPspReconciliation(params: {
    providerCode: string;
    runDate: string;
    expectedOrders: Array<{ orderId: string; totalCents: number }>;
    pspReportedCaptures: Array<{ orderId: string; capturedCents: number }>;
    idempotencyKey: string;
  }): Promise<{ data: PspReconciliationRunContract }> {
    return this.request<{ data: PspReconciliationRunContract }>({
      path: "/finance/reconciliation-runs",
      method: "POST",
      body: {
        providerCode: params.providerCode,
        runDate: params.runDate,
        expectedOrders: params.expectedOrders,
        pspReportedCaptures: params.pspReportedCaptures,
      },
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async executeSettlementPayout(params: {
    settlementId: string;
    providerCode: string;
    bankAccountApprovedByActorId?: string | null;
    externalPayoutReference?: string | null;
    idempotencyKey: string;
  }): Promise<{ data: SettlementRecordContract }> {
    return this.request<{ data: SettlementRecordContract }>({
      path: `/finance/settlements/${encodeURIComponent(params.settlementId)}/execute`,
      method: "POST",
      body: {
        providerCode: params.providerCode,
        bankAccountApprovedByActorId: params.bankAccountApprovedByActorId ?? null,
        externalPayoutReference: params.externalPayoutReference ?? null,
      },
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async acceptDeliveryOffer(params: {
    offerId: string;
    isCourierOnline: boolean;
    idempotencyKey: string;
  }): Promise<{
    data: {
      offer: DeliveryOfferContract;
      task: DeliveryTaskContract;
    };
  }> {
    return this.request({
      path: `/logistics/offers/${encodeURIComponent(params.offerId)}/accept`,
      method: "POST",
      body: {
        isCourierOnline: params.isCourierOnline,
      },
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async submitCourierLocationSample(params: {
    deliveryTaskId: string | null;
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    recordedAtIso: string;
    idempotencyKey: string;
  }): Promise<{ data: CourierLocationSampleContract }> {
    return this.request<{ data: CourierLocationSampleContract }>({
      path: "/logistics/location-samples",
      method: "POST",
      body: {
        deliveryTaskId: params.deliveryTaskId,
        latitude: params.latitude,
        longitude: params.longitude,
        accuracyMeters: params.accuracyMeters,
        recordedAtIso: params.recordedAtIso,
      },
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async completeDeliveryTaskWithOtp(params: {
    taskId: string;
    confirmationCode: string;
    idempotencyKey: string;
  }): Promise<{ data: DeliveryTaskContract }> {
    return this.request<{ data: DeliveryTaskContract }>({
      path: `/logistics/tasks/${encodeURIComponent(params.taskId)}/complete`,
      method: "POST",
      body: {
        confirmationCode: params.confirmationCode,
      },
      idempotencyKey: params.idempotencyKey,
      requireIdempotency: true,
    });
  }

  public async getStoreDetail(
    storeIdOrSlug: string
  ): Promise<{ data: StoreDetailResponseContract }> {
    return this.request<{ data: StoreDetailResponseContract }>({
      path: `/stores/${encodeURIComponent(storeIdOrSlug)}?locale=${encodeURIComponent(this.locale)}`,
      method: "GET",
    });
  }

  public async replaceStoreHours(params: {
    storeId: string;
    hours: StoreOperatingHourContract[];
  }): Promise<{ data: StoreOperatingHourContract[] }> {
    return this.request<{ data: StoreOperatingHourContract[] }>({
      path: `/partner/stores/${encodeURIComponent(params.storeId)}/hours`,
      method: "PUT",
      body: { hours: params.hours },
    });
  }

  public async upsertStoreHourException(params: {
    storeId: string;
    exception: StoreHourExceptionContract;
  }): Promise<{ data: StoreHourExceptionContract }> {
    return this.request<{ data: StoreHourExceptionContract }>({
      path: `/partner/stores/${encodeURIComponent(params.storeId)}/hour-exceptions`,
      method: "POST",
      body: params.exception as unknown as Record<string, unknown>,
    });
  }

  public async createStoreServiceArea(params: {
    storeId: string;
    area: Omit<StoreServiceAreaContract, "id" | "storeId">;
  }): Promise<{ data: StoreServiceAreaContract }> {
    return this.request<{ data: StoreServiceAreaContract }>({
      path: `/partner/stores/${encodeURIComponent(params.storeId)}/service-areas`,
      method: "POST",
      body: params.area as unknown as Record<string, unknown>,
    });
  }

  public async createCatalogCategory(params: {
    storeId: string;
    category: CatalogCategoryUpsertContract;
  }): Promise<{ data: CatalogCategoryContract }> {
    return this.request<{ data: CatalogCategoryContract }>({
      path: `/partner/stores/${encodeURIComponent(params.storeId)}/categories`,
      method: "POST",
      body: params.category as unknown as Record<string, unknown>,
    });
  }

  public async createCatalogProduct(params: {
    storeId: string;
    product: CatalogProductUpsertContract;
  }): Promise<{ data: CatalogProductContract }> {
    return this.request<{ data: CatalogProductContract }>({
      path: `/partner/stores/${encodeURIComponent(params.storeId)}/products`,
      method: "POST",
      body: params.product as unknown as Record<string, unknown>,
    });
  }

  public async createCatalogOptionGroup(params: {
    productId: string;
    optionGroup: CatalogOptionGroupUpsertContract;
  }): Promise<{ data: CatalogOptionGroupContract }> {
    return this.request<{ data: CatalogOptionGroupContract }>({
      path: `/partner/products/${encodeURIComponent(params.productId)}/option-groups`,
      method: "POST",
      body: params.optionGroup as unknown as Record<string, unknown>,
    });
  }

  public async createCatalogOption(params: {
    productId: string;
    optionGroupId: string;
    option: CatalogOptionUpsertContract;
  }): Promise<{ data: CatalogOptionContract }> {
    return this.request<{ data: CatalogOptionContract }>({
      path: `/partner/products/${encodeURIComponent(params.productId)}/option-groups/${encodeURIComponent(params.optionGroupId)}/options`,
      method: "POST",
      body: params.option as unknown as Record<string, unknown>,
    });
  }

  public async executeMultiUnitCatalogBatch(params: {
    organizationId: string;
    targetStoreIds: string[];
    productId: string;
    priceCents?: number;
    isAvailable?: boolean;
    isPaused?: boolean;
    dryRun?: boolean;
  }): Promise<{ data: BatchCatalogUpdateItemResultContract[]; dryRun: boolean }> {
    return this.request<{
      data: BatchCatalogUpdateItemResultContract[];
      dryRun: boolean;
    }>({
      path: `/organizations/${encodeURIComponent(params.organizationId)}/catalog/batch`,
      method: "POST",
      body: {
        targetStoreIds: params.targetStoreIds,
        productId: params.productId,
        priceCents: params.priceCents,
        isAvailable: params.isAvailable,
        isPaused: params.isPaused,
        dryRun: Boolean(params.dryRun),
      },
    });
  }

  public async createSignedUploadUrl(
    params: SignedUploadUrlRequestContract
  ): Promise<{ data: SignedUploadUrlResponseContract }> {
    return this.request<{ data: SignedUploadUrlResponseContract }>({
      path: "/storage/signed-upload-url",
      method: "POST",
      body: params as unknown as Record<string, unknown>,
    });
  }

  public async getMe(): Promise<{ data: AuthenticatedActorProfileContract }> {
    return this.request<{ data: AuthenticatedActorProfileContract }>({
      path: "/me",
      method: "GET",
    });
  }

  public async createMyAddress(
    address: Omit<CustomerAddressContract, "id" | "userId"> & { id?: string }
  ): Promise<{ data: CustomerAddressContract }> {
    return this.request<{ data: CustomerAddressContract }>({
      path: "/me/addresses",
      method: "POST",
      body: address as unknown as Record<string, unknown>,
    });
  }

  public async listMyDevices(): Promise<{ data: UserDeviceContract[] }> {
    return this.request<{ data: UserDeviceContract[] }>({
      path: "/me/devices",
      method: "GET",
    });
  }

  public async revokeMyDevice(deviceId: string): Promise<{
    status: "REVOKED";
    deviceId: string;
    revokedAt: string;
  }> {
    return this.request({
      path: "/me/devices/revoke",
      method: "POST",
      body: { deviceId },
    });
  }

  public async requestAccountDeletion(params: {
    hasActiveOrders: boolean;
    hasOpenFinancialDisputes: boolean;
    hasCompletedFiscalTransactions: boolean;
    reason?: string;
  }): Promise<{
    data: {
      userId: string;
      outcome: "IMMEDIATE_ANONYMIZATION" | "DEFERRED_RETENTION_HOLD";
      reasonCode: string;
      holdUntilIso: string | null;
    };
  }> {
    return this.request({
      path: "/me/privacy-requests",
      method: "POST",
      body: params,
    });
  }

  public async getOrder(orderId: string): Promise<{ data: OrderRecordContract }> {
    return this.request<{ data: OrderRecordContract }>({
      path: `/orders/${encodeURIComponent(orderId)}`,
      method: "GET",
    });
  }

  public async getOrderReview(
    orderId: string
  ): Promise<{ data: OrderReviewContract | null }> {
    return this.request<{ data: OrderReviewContract | null }>({
      path: `/orders/${encodeURIComponent(orderId)}/review`,
      method: "GET",
    });
  }

  public async submitOrderReview(params: {
    orderId: string;
    rating: number;
    comment?: string | null;
  }): Promise<{ data: OrderReviewContract }> {
    return this.request<{ data: OrderReviewContract }>({
      path: `/orders/${encodeURIComponent(params.orderId)}/review`,
      method: "POST",
      body: {
        rating: params.rating,
        comment: params.comment ?? null,
      },
    });
  }

  public async listOrderSupportCases(
    orderId: string
  ): Promise<{ data: SupportCaseContract[] }> {
    return this.request<{ data: SupportCaseContract[] }>({
      path: `/orders/${encodeURIComponent(orderId)}/support-cases`,
      method: "GET",
    });
  }

  public async createOrderSupportCase(params: {
    orderId: string;
    subject: string;
    category?: string;
    priority?: SupportCaseContract["priority"];
  }): Promise<{ data: SupportCaseContract }> {
    return this.request<{ data: SupportCaseContract }>({
      path: `/orders/${encodeURIComponent(params.orderId)}/support-cases`,
      method: "POST",
      body: {
        subject: params.subject,
        category: params.category ?? "ORDER_ISSUE",
        priority: params.priority ?? "MEDIUM",
      },
    });
  }
}
