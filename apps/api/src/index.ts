import crypto from "node:crypto";
import http from "node:http";
import {
  authorizePartnerScope,
  authorizeStaffAction,
  hashInvitationToken,
  validateInvitationAcceptance,
  type StoredInvitationRecord,
} from "@ideliveryfood/authz";
import {
  createStructuredLogEntry,
  inspectProviderReadiness,
} from "@ideliveryfood/config";
import {
  assertIntegerCents,
  CURRENCY_CODE,
  DEFAULT_LOCALE,
  resolveSupportedLocale,
  type AdminGovernanceActionContract,
  type AdminOverviewResponseContract,
  type AdminStaffScopeGrantRequestContract,
  type ApiErrorEnvelope,
  type AuthenticatedActorProfileContract,
  type AuthorizedStorageBucket,
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
  type FinanceBackofficeOverviewContract,
  type FleetsBackofficeOverviewContract,
  type FulfillmentModality,
  type LogisticsBackofficeOverviewContract,
  type MerchantContractRecordContract,
  type MultiUnitStoreSummaryContract,
  type OrderEventRecordContract,
  type OrderRecordContract,
  type OrderReviewContract,
  type PaginatedResponse,
  type PartnerFinanceSummaryContract,
  type PaymentAttemptContract,
  type PaymentMethodCode,
  type PspReconciliationRunContract,
  type PublishedStoreContract,
  type RefundRecordContract,
  type ServerQuoteRecordContract,
  type SettlementRecordContract,
  type SignedUploadUrlResponseContract,
  type StaffRole,
  type StoreCatalogResponseContract,
  type StoreDetailResponseContract,
  type StoreHourExceptionContract,
  type StoreOperatingHourContract,
  type StoreServiceAreaContract,
  type StoreSettingsPatchContract,
  type SupportActionRequestContract,
  type SupportAttachmentContract,
  type SupportBackofficeOverviewContract,
  type SupportCaseContract,
  type SupportCaseDetailResponseContract,
  type SupportCaseStatus,
  type SupportMessageContract,
  type SupportPriority,
  type SupportedLocale,
  type UserDeviceContract,
  type UserPreferencesContract,
  type CommercialBackofficeOverviewContract,
  type CommercialLeadContract,
  type CommercialLeadStatus,
  type CommercialProposalContract,
  type CommercialProposalStatus,
  type CommissionRuleVersionContract,
} from "@ideliveryfood/contracts";
import {
  DEFAULT_BR_PLATFORM_POLICY,
  acceptDeliveryOfferTransactional,
  assertExternalProviderReady,
  buildKitchenOrderQueue,
  buildVersionedContractAndCommissionRule,
  calculateServerQuoteAndSplit,
  computeSupportSlaDueAt,
  createBankAccountChangeRequest,
  createOrderFromServerQuote,
  decideEscalatedSupportActionRequest,
  evaluateAccountDeletionRequest,
  evaluateAdminGovernanceDecision,
  evaluateCourierLocationSample,
  evaluatePartnerContractAcceptance,
  evaluatePspReconciliationRun,
  evaluateRefundRequest,
  evaluateServiceAreaEligibility,
  evaluateSettlementPayoutExecution,
  evaluateStaffScopeGrant,
  evaluateStoreAvailability,
  evaluateSupportActionRequest,
  executeOrderCommand,
  filterSupportCaseViewForActor,
  hashDeliveryConfirmationCode,
  transitionCommercialLeadStatus,
  transitionSupportCaseStatus,
  validateAndBuildCommercialProposal,
  validateAndBuildQuoteItems,
  validateStoreSettingsPatch,
  verifyAndProcessPspWebhook,
  verifyDeliveryConfirmationCode,
  type OrderCommandType,
  type QuoteItemInput,
  type SupportActionType,
} from "@ideliveryfood/domain";
import {
  resolveRequestActor,
  signSupabaseHs256Jwt,
  verifySupabaseHs256Jwt,
  type VerifiedSupabaseJwtClaims,
} from "./auth-jwt.js";
import {
  createSupabasePostgresRepository,
  toDeterministicUuid,
  type SupabasePostgresRepositoryInstance,
} from "./postgres-repository.js";

export {
  createSupabasePostgresRepository,
  resolveRequestActor,
  signSupabaseHs256Jwt,
  toDeterministicUuid,
  verifySupabaseHs256Jwt,
  type SupabasePostgresRepositoryInstance,
  type VerifiedSupabaseJwtClaims,
};

export interface AuditLogWriteRecord {
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  correlationId: string;
  reason: string | null;
  redactedPayload: Record<string, unknown>;
  createdAt: string;
}

export interface ApiDataRepository {
  listPublishedStores(locale: SupportedLocale): Promise<PublishedStoreContract[]>;
  getStoreById(
    storeId: string,
    locale: SupportedLocale
  ): Promise<(PublishedStoreContract & { organizationId: string }) | null>;
  getStoreCatalog(
    storeId: string,
    locale: SupportedLocale
  ): Promise<{
    store: PublishedStoreContract;
    weeklyHours: StoreOperatingHourContract[];
    exceptions: StoreHourExceptionContract[];
    serviceAreas: StoreServiceAreaContract[];
    categories: CatalogCategoryContract[];
  } | null>;
  updateStoreSettings(
    storeId: string,
    patch: StoreSettingsPatchContract,
    locale: SupportedLocale
  ): Promise<PublishedStoreContract | null>;

  getActorById(
    userId: string,
    aal: "aal1" | "aal2"
  ): Promise<AuthenticatedActorProfileContract | null>;
  updateUserPreferences(
    userId: string,
    locale: SupportedLocale
  ): Promise<UserPreferencesContract>;
  revokeUserDevice(
    userId: string,
    deviceIdentifier: string,
    revokedAtIso: string
  ): Promise<void>;
  savePrivacyRequest(params: {
    id: string;
    userId: string;
    requestType: "EXPORT_DATA" | "DELETE_ACCOUNT" | "CORRECTION";
    status:
      | "REQUESTED"
      | "PROCESSING"
      | "COMPLETED"
      | "BLOCKED_LEGAL_RETENTION"
      | "REJECTED";
    reason: string | null;
    retentionBlockReason: string | null;
  }): Promise<void>;

  listOrganizationMembers(organizationId: string): Promise<
    Array<{
      userId: string;
      organizationId: string;
      storeId: string | null;
      role: string;
    }>
  >;
  saveInvitation(
    record: StoredInvitationRecord & {
      organizationId?: string;
      storeId?: string | null;
      role?: string;
      invitedBy?: string;
    }
  ): Promise<void>;
  getInvitationById(id: string): Promise<StoredInvitationRecord | null>;
  markInvitationConsumed(
    id: string,
    consumedAtIso: string,
    acceptedByUserId?: string
  ): Promise<void>;

  appendAuditLog(entry: AuditLogWriteRecord): Promise<void>;
  getAuditLogs(): Promise<AuditLogWriteRecord[]>;

  listCustomerAddresses(userId: string): Promise<CustomerAddressContract[]>;
  saveCustomerAddress(address: CustomerAddressContract): Promise<void>;

  saveQuote(quote: ServerQuoteRecordContract): Promise<void>;
  getQuoteById(quoteId: string): Promise<ServerQuoteRecordContract | null>;
  getQuoteByCustomerIdempotencyKey(
    customerId: string,
    idempotencyKey: string
  ): Promise<ServerQuoteRecordContract | null>;
  markQuoteConsumed(quoteId: string, consumedAtIso: string): Promise<void>;

  nextOrderNumber(): Promise<number>;
  saveOrder(
    order: OrderRecordContract,
    initialEvent: OrderEventRecordContract
  ): Promise<void>;
  getOrderById(orderId: string): Promise<OrderRecordContract | null>;
  getOrderByCustomerIdempotencyKey(
    customerId: string,
    idempotencyKey: string
  ): Promise<OrderRecordContract | null>;
  listOrdersByStore(storeId: string): Promise<OrderRecordContract[]>;
  updateOrderWithEvent(
    order: OrderRecordContract,
    event: OrderEventRecordContract
  ): Promise<void>;
  listOrderEvents(orderId: string): Promise<OrderEventRecordContract[]>;

  hasProcessedWebhookEvent(
    providerCode: string,
    externalEventId: string
  ): Promise<boolean>;
  recordProcessedWebhookEvent(params: {
    providerCode: string;
    externalEventId: string;
    paymentAttemptId: string | null;
    eventType: string;
    redactedPayload: Record<string, unknown>;
  }): Promise<void>;
  savePaymentAttempt(attempt: PaymentAttemptContract): Promise<void>;
  listRefundsByOrder(orderId: string): Promise<RefundRecordContract[]>;
  saveRefundAndUpdateOrder(
    refund: RefundRecordContract,
    updatedOrder: OrderRecordContract
  ): Promise<void>;

  saveBankAccountChangeRequest(req: BankAccountChangeRequestContract): Promise<void>;
  grantStaffScope(
    grant: AdminStaffScopeGrantRequestContract & { grantedBy: string }
  ): Promise<void>;
  saveGovernanceApprovalEvent(
    action: AdminGovernanceActionContract & { organizationId?: string | null }
  ): Promise<void>;

  saveReconciliationRun(run: PspReconciliationRunContract): Promise<void>;
  getSettlementById(settlementId: string): Promise<SettlementRecordContract | null>;
  saveSettlement(settlement: SettlementRecordContract): Promise<void>;

  saveDeliveryTaskAndOffer(params: {
    task: DeliveryTaskContract;
    fullAddress: string;
    confirmationCodeHash: string;
    offer: DeliveryOfferContract;
  }): Promise<void>;
  getDeliveryOfferById(offerId: string): Promise<DeliveryOfferContract | null>;
  getDeliveryTaskById(taskId: string): Promise<{
    task: DeliveryTaskContract;
    fullAddress: string | null;
    confirmationCodeHash: string | null;
  } | null>;
  saveAcceptedDeliveryOffer(params: {
    offer: DeliveryOfferContract;
    task: DeliveryTaskContract;
    fullAddress: string;
  }): Promise<void>;
  completeDeliveryTask(task: DeliveryTaskContract): Promise<void>;
  saveCourierLocationSample(sample: CourierLocationSampleContract): Promise<void>;

  replaceStoreOperatingHours(
    storeId: string,
    hours: StoreOperatingHourContract[]
  ): Promise<StoreOperatingHourContract[]>;
  upsertStoreHourException(
    storeId: string,
    exception: StoreHourExceptionContract
  ): Promise<StoreHourExceptionContract>;
  deleteStoreHourException(
    storeId: string,
    exceptionDate: string
  ): Promise<boolean>;

  createStoreServiceArea(
    area: StoreServiceAreaContract
  ): Promise<StoreServiceAreaContract>;
  updateStoreServiceArea(
    storeId: string,
    areaId: string,
    patch: Partial<Omit<StoreServiceAreaContract, "id" | "storeId">>
  ): Promise<StoreServiceAreaContract | null>;
  deleteStoreServiceArea(storeId: string, areaId: string): Promise<boolean>;

  createCatalogCategory(
    storeId: string,
    input: CatalogCategoryUpsertContract & { id?: string },
    locale?: SupportedLocale
  ): Promise<CatalogCategoryContract>;
  updateCatalogCategory(
    storeId: string,
    categoryId: string,
    patch: Partial<CatalogCategoryUpsertContract>,
    locale?: SupportedLocale
  ): Promise<CatalogCategoryContract | null>;
  deleteCatalogCategory(storeId: string, categoryId: string): Promise<boolean>;

  getProductStoreId(productId: string): Promise<string | null>;
  createCatalogProduct(
    storeId: string,
    input: CatalogProductUpsertContract & { id?: string },
    locale?: SupportedLocale
  ): Promise<CatalogProductContract>;
  updateCatalogProduct(
    storeId: string,
    productId: string,
    patch: Partial<CatalogProductUpsertContract>,
    locale?: SupportedLocale
  ): Promise<CatalogProductContract | null>;
  deleteCatalogProduct(storeId: string, productId: string): Promise<boolean>;

  createCatalogOptionGroup(
    productId: string,
    storeId: string,
    input: CatalogOptionGroupUpsertContract & { id?: string },
    locale?: SupportedLocale
  ): Promise<CatalogOptionGroupContract>;
  updateCatalogOptionGroup(
    productId: string,
    groupId: string,
    patch: Partial<CatalogOptionGroupUpsertContract>,
    locale?: SupportedLocale
  ): Promise<CatalogOptionGroupContract | null>;
  deleteCatalogOptionGroup(
    productId: string,
    groupId: string
  ): Promise<boolean>;
  getOptionGroupContext(
    groupId: string
  ): Promise<{ productId: string; storeId: string } | null>;

  createCatalogOption(
    groupId: string,
    storeId: string,
    input: CatalogOptionUpsertContract & { id?: string },
    locale?: SupportedLocale
  ): Promise<CatalogOptionContract>;
  updateCatalogOption(
    optionId: string,
    storeId: string,
    patch: Partial<CatalogOptionUpsertContract>,
    locale?: SupportedLocale
  ): Promise<CatalogOptionContract | null>;
  deleteCatalogOption(optionId: string, storeId: string): Promise<boolean>;
  getOptionContext(
    optionId: string
  ): Promise<{ optionGroupId: string; productId: string; storeId: string } | null>;

  saveStorageUploadIntent(params: {
    id: string;
    bucket: AuthorizedStorageBucket;
    objectPath: string;
    mimeType: string;
    fileSizeBytes: number;
    uploadedBy: string;
    storeId: string | null;
    organizationId: string | null;
    signedTokenHash: string;
    expiresAtIso: string;
  }): Promise<void>;

  listUserDevices?(userId: string): Promise<UserDeviceContract[]>;
  getOrderReview?(orderId: string): Promise<OrderReviewContract | null>;
  saveOrderReview?(review: OrderReviewContract): Promise<OrderReviewContract>;
  listOrderSupportCases?(orderId: string): Promise<SupportCaseContract[]>;
  createSupportCase?(supportCase: Omit<SupportCaseContract, "caseNumber">): Promise<SupportCaseContract>;
  getPartnerFinanceSummary?(organizationId: string): Promise<PartnerFinanceSummaryContract>;
  getMerchantContract?(organizationId: string): Promise<MerchantContractRecordContract | null>;
  listStoreReviews?(storeId: string): Promise<OrderReviewContract[]>;
  replyToStoreReview?(storeId: string, reviewId: string, replyText: string): Promise<OrderReviewContract | null>;
  listStoreSupportCases?(storeId: string): Promise<SupportCaseContract[]>;
  getAdminOverview?(): Promise<AdminOverviewResponseContract>;
  getFinanceBackofficeOverview?(): Promise<FinanceBackofficeOverviewContract>;
  getLogisticsBackofficeOverview?(): Promise<LogisticsBackofficeOverviewContract>;
  getFleetsBackofficeOverview?(): Promise<FleetsBackofficeOverviewContract>;
  listSupportCasesForActor?(params: {
    actorId: string;
    isStaffActor: boolean;
    storeIds: readonly string[];
    statusFilter?: string;
  }): Promise<SupportCaseContract[]>;
  getSupportCaseDetail?(caseId: string): Promise<SupportCaseDetailResponseContract | null>;
  updateSupportCaseStatus?(params: {
    caseId: string;
    status: SupportCaseStatus;
    assignedStaffId?: string | null;
    resolvedAtIso?: string | null;
  }): Promise<SupportCaseContract | null>;
  createSupportMessage?(params: {
    message: SupportMessageContract;
    attachments?: SupportAttachmentContract[];
  }): Promise<{
    message: SupportMessageContract;
    attachments: SupportAttachmentContract[];
  }>;
  getSupportAutoRefundLimitCents?(): Promise<number>;
  createSupportActionRequest?(req: SupportActionRequestContract): Promise<SupportActionRequestContract>;
  getSupportActionRequestById?(requestId: string): Promise<SupportActionRequestContract | null>;
  updateSupportActionRequestDecision?(req: SupportActionRequestContract): Promise<SupportActionRequestContract>;
  getSupportBackofficeOverview?(): Promise<SupportBackofficeOverviewContract>;
  listCommercialLeads?(statusFilter?: string): Promise<CommercialLeadContract[]>;
  getCommercialLeadById?(leadId: string): Promise<CommercialLeadContract | null>;
  createCommercialLead?(lead: CommercialLeadContract): Promise<CommercialLeadContract>;
  updateCommercialLeadStatus?(lead: CommercialLeadContract): Promise<CommercialLeadContract>;
  createCommercialProposal?(proposal: CommercialProposalContract): Promise<CommercialProposalContract>;
  getCommercialProposalById?(proposalId: string): Promise<CommercialProposalContract | null>;
  convertCommercialLeadAndProposal?(params: {
    lead: CommercialLeadContract;
    proposal: CommercialProposalContract;
    contract: MerchantContractRecordContract;
    commissionRule: CommissionRuleVersionContract;
    organizationId: string;
    organizationSlug: string;
    storeId: string;
    storeSlug: string;
    partnerOwnerUserId?: string | null;
  }): Promise<{
    organizationId: string;
    storeId: string;
    lead: CommercialLeadContract;
    proposal: CommercialProposalContract;
    contract: MerchantContractRecordContract;
    commissionRule: CommissionRuleVersionContract;
  }>;
  getMerchantContractById?(contractId: string): Promise<MerchantContractRecordContract | null>;
  acceptMerchantContractByPartnerOwner?(
    contract: MerchantContractRecordContract
  ): Promise<MerchantContractRecordContract>;
  listCommissionRuleVersions?(organizationId: string): Promise<CommissionRuleVersionContract[]>;
  getCommercialBackofficeOverview?(): Promise<CommercialBackofficeOverviewContract>;
}

/**
 * Live Supabase PostgREST adapter for querying published stores from dwsoochnfxldfvcaijie.
 */
export async function fetchPublishedStoresFromSupabaseRest(params: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  locale?: SupportedLocale;
  fetchImpl?: typeof fetch;
}): Promise<PublishedStoreContract[]> {
  const fetchFn = params.fetchImpl ?? globalThis.fetch;
  const locale = params.locale ?? DEFAULT_LOCALE;
  const endpoint = `${params.supabaseUrl.replace(/\/+$/, "")}/rest/v1/published_stores_v?select=*&order=name.asc`;

  const response = await fetchFn(endpoint, {
    method: "GET",
    headers: {
      apikey: params.supabaseAnonKey,
      Authorization: `Bearer ${params.supabaseAnonKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`SUPABASE_REST_ERROR: HTTP ${response.status}`);
  }

  const rows = (await response.json()) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const descriptionEn = String(row.description_en ?? "");
    const descriptionPtBr = String(row.description_pt_br ?? "");
    return {
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      descriptionEn,
      descriptionPtBr,
      localizedDescription: locale === "pt-BR" ? descriptionPtBr : descriptionEn,
      cuisineCategory: String(row.cuisine_category),
      isPaused: Boolean(row.is_paused),
      timezone: String(row.timezone ?? "America/Sao_Paulo"),
      city: String(row.city),
      stateCode: String(row.state_code),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      minOrderCents: Number(row.min_order_cents),
      prepTimeMinMinutes: Number(row.prep_time_min_minutes),
      prepTimeMaxMinutes: Number(row.prep_time_max_minutes),
      supportedModalities: (row.supported_modalities as PublishedStoreContract["supportedModalities"]) ?? [
        "PLATFORM_DELIVERY",
      ],
    };
  });
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  correlationId: string,
  payload: unknown
): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Correlation-Id": correlationId,
  });
  res.end(JSON.stringify(payload));
}

function sendError(
  res: http.ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  correlationId: string
): void {
  const envelope: ApiErrorEnvelope = {
    error: {
      code,
      message,
      correlationId,
      timestamp: new Date().toISOString(),
    },
  };
  sendJson(res, statusCode, correlationId, envelope);
}

async function readRawAndJsonBody(
  req: http.IncomingMessage
): Promise<{ raw: string; json: Record<string, unknown> }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return { raw: "", json: {} };
  const raw = Buffer.concat(chunks).toString("utf8");
  return {
    raw,
    json: JSON.parse(raw) as Record<string, unknown>,
  };
}

export function createApiServer(deps: {
  repository: ApiDataRepository;
  env?: Record<string, string | undefined>;
  allowTestActorHeaders?: boolean;
}): http.Server {
  const env = deps.env ?? process.env;

  return http.createServer(async (req, res) => {
    const correlationId =
      (req.headers["x-correlation-id"] as string | undefined) ??
      `corr_${crypto.randomUUID()}`;
    const locale = resolveSupportedLocale(
      (req.headers["accept-language"] as string | undefined) ?? DEFAULT_LOCALE
    );
    const parsedUrl = new URL(req.url ?? "/", "http://localhost");
    const pathname = parsedUrl.pathname;
    const method = req.method ?? "GET";

    try {
      // 1. Liveness Probe
      if (method === "GET" && pathname === "/v1/health/live") {
        sendJson(res, 200, correlationId, {
          status: "ALIVE",
          service: "@ideliveryfood/api",
          version: "v1",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // 2. Readiness Probe
      if (method === "GET" && pathname === "/v1/health/ready") {
        const providers = inspectProviderReadiness(env);
        sendJson(res, 200, correlationId, {
          status: "READY",
          databaseProjectRef: "dwsoochnfxldfvcaijie",
          operationalTimezone: "America/Sao_Paulo",
          currencyCode: "BRL",
          defaultLocale: DEFAULT_LOCALE,
          externalProviders: providers,
        });
        return;
      }

      // 3. External Provider Readiness Endpoint
      if (method === "GET" && pathname === "/v1/system/providers") {
        sendJson(res, 200, correlationId, {
          data: inspectProviderReadiness(env),
        });
        return;
      }

      // 4. Public Published Stores Discovery (M04: search + cuisine filter)
      if (method === "GET" && pathname === "/v1/stores") {
        const queryLocale = resolveSupportedLocale(
          parsedUrl.searchParams.get("locale") ?? locale
        );
        const searchTerm = (parsedUrl.searchParams.get("search") ?? "")
          .trim()
          .toLowerCase();
        const cuisineFilter = (parsedUrl.searchParams.get("cuisineCategory") ?? "")
          .trim()
          .toUpperCase();

        let stores = await deps.repository.listPublishedStores(queryLocale);
        if (searchTerm) {
          stores = stores.filter(
            (s) =>
              s.name.toLowerCase().includes(searchTerm) ||
              s.localizedDescription.toLowerCase().includes(searchTerm)
          );
        }
        if (cuisineFilter) {
          stores = stores.filter(
            (s) => s.cuisineCategory.toUpperCase() === cuisineFilter
          );
        }

        const response: PaginatedResponse<PublishedStoreContract> = {
          data: stores,
          meta: {
            page: 1,
            pageSize: 20,
            totalItems: stores.length,
            totalPages: stores.length > 0 ? 1 : 0,
          },
        };
        sendJson(res, 200, correlationId, response);
        return;
      }

      // 4b. GET /v1/stores/:storeId/catalog (M04 / M05)
      const storeCatalogMatch = pathname.match(/^\/v1\/stores\/([^/]+)\/catalog$/);
      if (method === "GET" && storeCatalogMatch) {
        const storeId = storeCatalogMatch[1] ?? "";
        const queryLocale = resolveSupportedLocale(
          parsedUrl.searchParams.get("locale") ?? locale
        );
        const catalogData = await deps.repository.getStoreCatalog(
          storeId,
          queryLocale
        );

        if (!catalogData) {
          sendError(
            res,
            404,
            "STORE_NOT_FOUND",
            `Published store ${storeId} not found.`,
            correlationId
          );
          return;
        }

        const availability = evaluateStoreAvailability({
          storeId: catalogData.store.id,
          isPublished: true,
          isPaused: catalogData.store.isPaused,
          weeklyHours: catalogData.weeklyHours,
          exceptions: catalogData.exceptions,
        });

        const payload: StoreCatalogResponseContract = {
          store: catalogData.store,
          availability,
          categories: catalogData.categories,
        };
        sendJson(res, 200, correlationId, { data: payload });
        return;
      }

      // 4c. GET /v1/stores/:storeId/availability (M04)
      const storeAvailMatch = pathname.match(/^\/v1\/stores\/([^/]+)\/availability$/);
      if (method === "GET" && storeAvailMatch) {
        const storeId = storeAvailMatch[1] ?? "";
        const catalogData = await deps.repository.getStoreCatalog(storeId, locale);

        if (!catalogData) {
          sendError(
            res,
            404,
            "STORE_NOT_FOUND",
            `Published store ${storeId} not found.`,
            correlationId
          );
          return;
        }

        const availability = evaluateStoreAvailability({
          storeId: catalogData.store.id,
          isPublished: true,
          isPaused: catalogData.store.isPaused,
          weeklyHours: catalogData.weeklyHours,
          exceptions: catalogData.exceptions,
        });

        const latParam = parsedUrl.searchParams.get("lat");
        const lngParam = parsedUrl.searchParams.get("lng");
        const modalityParam = (parsedUrl.searchParams.get("modality") ??
          "PLATFORM_DELIVERY") as FulfillmentModality;
        const basketCents = Number(parsedUrl.searchParams.get("basketCents") ?? 0);

        const coverage =
          latParam !== null &&
          lngParam !== null &&
          catalogData.store.latitude !== undefined &&
          catalogData.store.longitude !== undefined
            ? evaluateServiceAreaEligibility({
                storeId: catalogData.store.id,
                storeLatitude: catalogData.store.latitude,
                storeLongitude: catalogData.store.longitude,
                customerLatitude: Number(latParam),
                customerLongitude: Number(lngParam),
                fulfillmentModality: modalityParam,
                grossMerchandiseCents: basketCents,
                serviceAreas: catalogData.serviceAreas,
              })
            : null;

        sendJson(res, 200, correlationId, {
          data: {
            availability,
            coverage,
          },
        });
        return;
      }

      // 4d. POST /v1/webhooks/psp/:providerCode (M12 — authenticated via HMAC signature, not user JWT)
      const webhookMatch = pathname.match(/^\/v1\/webhooks\/psp\/([^/]+)$/);
      if (method === "POST" && webhookMatch) {
        const providerCode = webhookMatch[1] ?? "";
        const signatureHeader = String(req.headers["x-psp-signature"] ?? "");
        const timestampHeader = Number(req.headers["x-psp-timestamp"] ?? 0);
        const { raw, json } = await readRawAndJsonBody(req);

        const orderId = String(json.orderId ?? "");
        const externalEventId = String(json.externalEventId ?? "");
        const eventType = (json.eventType ?? "payment.captured") as
          | "payment.captured"
          | "payment.failed";
        const amountCents = Number(json.amountCents ?? 0);
        const currencyCode = String(json.currencyCode ?? CURRENCY_CODE);

        const order = await deps.repository.getOrderById(orderId);
        if (!order) {
          sendError(
            res,
            404,
            "ORDER_NOT_FOUND",
            `Order ${orderId} not found.`,
            correlationId
          );
          return;
        }

        const webhookSecret =
          env[`${providerCode.toUpperCase()}_WEBHOOK_SECRET`] ??
          "whsec_default_dev_test";
        const nowSeconds = Math.floor(Date.now() / 1000);
        const alreadyProcessed = await deps.repository.hasProcessedWebhookEvent(
          providerCode,
          externalEventId
        );
        const processedSet = new Set<string>(
          alreadyProcessed ? [`${providerCode}:${externalEventId}`] : []
        );

        try {
          const result = verifyAndProcessPspWebhook({
            providerCode,
            externalEventId,
            eventType,
            webhookSecret,
            signatureHeader,
            timestampSeconds: timestampHeader,
            nowSeconds,
            rawPayload: raw,
            webhookAmountCents: amountCents,
            webhookCurrencyCode: currencyCode,
            order,
            processedEventKeys: processedSet,
          });

          if (!result.deduplicated && result.event) {
            await deps.repository.recordProcessedWebhookEvent({
              providerCode,
              externalEventId,
              paymentAttemptId: null,
              eventType,
              redactedPayload: {
                orderId: order.id,
                amountCents,
                currencyCode,
              },
            });
            await deps.repository.updateOrderWithEvent(
              result.updatedOrder,
              result.event
            );
          }

          sendJson(res, 200, correlationId, {
            data: {
              deduplicated: result.deduplicated,
              action: result.action,
              orderStatus: result.updatedOrder.orderStatus,
              paymentStatus: result.updatedOrder.paymentStatus,
              version: result.updatedOrder.version,
            },
          });
          return;
        } catch (webhookErr) {
          const msg =
            webhookErr instanceof Error
              ? webhookErr.message
              : "Webhook verification failed";
          const status =
            msg.startsWith("WEBHOOK_INVALID_SIGNATURE") ||
            msg.startsWith("WEBHOOK_TIMESTAMP")
              ? 401
              : 400;
          sendError(
            res,
            status,
            msg.split(":")[0] ?? "WEBHOOK_ERROR",
            msg,
            correlationId
          );
          return;
        }
      }

      // Resolve authenticated actor via Bearer JWT or (when permitted in test mode) X-Actor-Id
      const resolvedAuth = await resolveRequestActor({
        req,
        repository: deps.repository,
        env,
        ...(deps.allowTestActorHeaders !== undefined
          ? { allowTestActorHeaders: deps.allowTestActorHeaders }
          : {}),
      });
      if (resolvedAuth.authErrorCode) {
        sendError(
          res,
          401,
          resolvedAuth.authErrorCode,
          resolvedAuth.authErrorMessage ?? "Authentication failed.",
          correlationId
        );
        return;
      }
      const actor = resolvedAuth.actor;

      // 5. GET /v1/me
      if (method === "GET" && pathname === "/v1/me") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        sendJson(res, 200, correlationId, { data: actor });
        return;
      }

      // 5b. GET & POST /v1/me/addresses (M05)
      if (pathname === "/v1/me/addresses") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        if (method === "GET") {
          const list = await deps.repository.listCustomerAddresses(actor.id);
          sendJson(res, 200, correlationId, { data: list });
          return;
        }
        if (method === "POST") {
          const { json: body } = await readRawAndJsonBody(req);
          const streetLine = String(body.streetLine ?? "").trim();
          const neighborhood = String(body.neighborhood ?? "").trim();
          const city = String(body.city ?? "").trim();
          const stateCode = String(body.stateCode ?? "").trim().toUpperCase();
          const postalCode = String(body.postalCode ?? "").trim();
          const latitude = Number(body.latitude);
          const longitude = Number(body.longitude);

          if (
            !streetLine ||
            !neighborhood ||
            !city ||
            stateCode.length !== 2 ||
            !postalCode ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
          ) {
            sendError(
              res,
              400,
              "VALIDATION_ERROR",
              "streetLine, neighborhood, city, stateCode (2 chars), postalCode, latitude, and longitude are required.",
              correlationId
            );
            return;
          }

          const newAddr: CustomerAddressContract = {
            id: body.id ? String(body.id) : crypto.randomUUID(),
            userId: actor.id,
            label: String(body.label ?? "Home"),
            recipientName: String(body.recipientName ?? actor.fullName),
            streetLine,
            number: String(body.number ?? "S/N"),
            complement: body.complement ? String(body.complement) : null,
            neighborhood,
            city,
            stateCode,
            postalCode,
            latitude,
            longitude,
            deliveryInstructions: body.deliveryInstructions
              ? String(body.deliveryInstructions)
              : null,
            isDefault: Boolean(body.isDefault ?? true),
          };
          await deps.repository.saveCustomerAddress(newAddr);
          sendJson(res, 201, correlationId, { data: newAddr });
          return;
        }
      }

      // 6. PATCH /v1/me/preferences (Language en / pt-BR persistence)
      if (method === "PATCH" && pathname === "/v1/me/preferences") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const idempotencyKey = req.headers["x-idempotency-key"] as string | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }
        const { json: body } = await readRawAndJsonBody(req);
        const targetLocale = resolveSupportedLocale(
          String(body.locale ?? DEFAULT_LOCALE)
        );
        const updated = await deps.repository.updateUserPreferences(
          actor.id,
          targetLocale
        );

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: "USER_LOCALE_PREFERENCE_UPDATED",
          targetType: "USER_PREFERENCES",
          targetId: actor.id,
          correlationId,
          reason: `Updated locale to ${targetLocale}`,
          redactedPayload: { locale: targetLocale },
          createdAt: new Date().toISOString(),
        });

        sendJson(res, 200, correlationId, updated);
        return;
      }

      // 7. GET /v1/me/devices & POST /v1/me/devices/revoke
      if (method === "GET" && pathname === "/v1/me/devices") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const devices = deps.repository.listUserDevices
          ? await deps.repository.listUserDevices(actor.id)
          : [];
        sendJson(res, 200, correlationId, { data: devices });
        return;
      }

      if (method === "POST" && pathname === "/v1/me/devices/revoke") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const { json: body } = await readRawAndJsonBody(req);
        const deviceId = String(body.deviceId ?? "").trim();
        if (!deviceId) {
          sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "deviceId is required.",
            correlationId
          );
          return;
        }

        const revokedAt = new Date().toISOString();
        await deps.repository.revokeUserDevice(actor.id, deviceId, revokedAt);

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: "DEVICE_SESSION_REVOKED",
          targetType: "USER_DEVICE",
          targetId: deviceId,
          correlationId,
          reason: "User initiated device session revocation",
          redactedPayload: { deviceId },
          createdAt: revokedAt,
        });

        sendJson(res, 200, correlationId, {
          status: "REVOKED",
          deviceId,
          revokedAt,
        });
        return;
      }

      // 8. POST /v1/me/privacy-requests (LGPD Deletion & Legal Hold Check)
      if (method === "POST" && pathname === "/v1/me/privacy-requests") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const { json: body } = await readRawAndJsonBody(req);
        const evaluation = evaluateAccountDeletionRequest({
          userId: actor.id,
          hasActiveOrders: Boolean(body.hasActiveOrders),
          hasOpenFinancialDisputes: Boolean(body.hasOpenFinancialDisputes),
          hasCompletedFiscalTransactions: Boolean(
            body.hasCompletedFiscalTransactions
          ),
          requestedAt: new Date(),
        });

        const requestId = crypto.randomUUID();
        await deps.repository.savePrivacyRequest({
          id: requestId,
          userId: actor.id,
          requestType: "DELETE_ACCOUNT",
          status:
            evaluation.outcome === "IMMEDIATE_ANONYMIZATION"
              ? "PROCESSING"
              : "BLOCKED_LEGAL_RETENTION",
          reason: body.reason ? String(body.reason) : null,
          retentionBlockReason: evaluation.reasonCode,
        });

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: "PRIVACY_DELETION_EVALUATED",
          targetType: "PROFILE",
          targetId: actor.id,
          correlationId,
          reason: evaluation.reasonCode,
          redactedPayload: {
            outcome: evaluation.outcome,
            holdUntilIso: evaluation.holdUntilIso,
          },
          createdAt: new Date().toISOString(),
        });

        sendJson(res, 201, correlationId, { data: evaluation });
        return;
      }

      // 9. GET /v1/organizations/:orgId/members (Multi-Tenant Isolation Check)
      const orgMembersMatch = pathname.match(/^\/v1\/organizations\/([^/]+)\/members$/);
      if (method === "GET" && orgMembersMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const orgId = orgMembersMatch[1] ?? "";
        const decision = authorizePartnerScope({
          actor,
          organizationId: orgId,
          allowedRoles: ["partner_owner", "partner_manager"],
        });

        if (!decision.allowed) {
          sendError(
            res,
            403,
            decision.reasonCode,
            "Cross-tenant or role access denied.",
            correlationId
          );
          return;
        }

        const members = await deps.repository.listOrganizationMembers(orgId);
        sendJson(res, 200, correlationId, { data: members });
        return;
      }

      // 9b. POST /v1/organizations/:orgId/catalog-batch & /v1/organizations/:orgId/catalog/batch (M09 Multi-unit batch update with partial results)
      const orgBatchMatch = pathname.match(
        /^\/v1\/organizations\/([^/]+)\/catalog(?:-batch|\/batch)$/
      );
      if (method === "POST" && orgBatchMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const orgId = orgBatchMatch[1] ?? "";
        const { json: body } = await readRawAndJsonBody(req);
        const targetStoreIds = (body.targetStoreIds as string[]) ?? [];
        const productId = String(body.productId ?? "");
        const dryRun = Boolean(body.dryRun);
        const patch: Partial<CatalogProductUpsertContract> = {};
        if (body.priceCents !== undefined) {
          patch.priceCents = assertIntegerCents(Number(body.priceCents), "priceCents");
        }
        if (body.isAvailable !== undefined) {
          patch.isAvailable = Boolean(body.isAvailable);
        }
        if (body.isPaused !== undefined) {
          patch.isPaused = Boolean(body.isPaused);
        }
        const results: BatchCatalogUpdateItemResultContract[] = [];

        for (const targetStoreId of targetStoreIds) {
          const decision = authorizePartnerScope({
            actor,
            organizationId: orgId,
            storeId: targetStoreId,
            allowedRoles: [
              "partner_owner",
              "partner_manager",
              "partner_catalog",
              "partner_operator",
            ],
          });
          if (!decision.allowed) {
            results.push({
              storeId: targetStoreId,
              productId,
              status: "DENIED_SCOPE",
              reasonCode: decision.reasonCode,
            });
          } else {
            if (!dryRun && Object.keys(patch).length > 0) {
              const updated = await deps.repository.updateCatalogProduct(
                targetStoreId,
                productId,
                patch,
                locale
              );
              if (!updated) {
                results.push({
                  storeId: targetStoreId,
                  productId,
                  status: "NOT_FOUND",
                  reasonCode: "PRODUCT_NOT_FOUND_IN_UNIT",
                });
                continue;
              }
            }
            results.push({
              storeId: targetStoreId,
              productId,
              status: "APPLIED",
              reasonCode: dryRun ? "DRY_RUN_ELIGIBLE" : "APPLIED_TO_UNIT",
            });
          }
        }

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: dryRun
            ? "MULTI_UNIT_CATALOG_BATCH_DRY_RUN"
            : "MULTI_UNIT_CATALOG_BATCH_EXECUTED",
          targetType: "ORGANIZATION",
          targetId: orgId,
          correlationId,
          reason: `Batch update for product ${productId}`,
          redactedPayload: {
            dryRun,
            appliedCount: results.filter((r) => r.status === "APPLIED").length,
            deniedCount: results.filter((r) => r.status === "DENIED_SCOPE").length,
          },
          createdAt: new Date().toISOString(),
        });

        sendJson(res, 200, correlationId, { data: results, dryRun });
        return;
      }

      // 9c. GET /v1/organizations/:orgId/units-summary (M09)
      const orgUnitsMatch = pathname.match(
        /^\/v1\/organizations\/([^/]+)\/units-summary$/
      );
      if (method === "GET" && orgUnitsMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const orgId = orgUnitsMatch[1] ?? "";
        const stores = await deps.repository.listPublishedStores(locale);
        const summaries: MultiUnitStoreSummaryContract[] = [];
        for (const st of stores) {
          const decision = authorizePartnerScope({
            actor,
            organizationId: orgId,
            storeId: st.id,
            allowedRoles: [
              "partner_owner",
              "partner_manager",
              "partner_operator",
              "partner_catalog",
              "partner_finance",
            ],
          });
          if (decision.allowed) {
            const storeOrders = await deps.repository.listOrdersByStore(st.id);
            summaries.push({
              storeId: st.id,
              storeName: st.name,
              isPublished: true,
              isPaused: st.isPaused,
              activeOrderCount: storeOrders.length,
              grossMerchandiseCents: storeOrders.reduce(
                (acc, o) => acc + o.subtotalCents + o.addonsCents,
                0
              ),
            });
          }
        }
        sendJson(res, 200, correlationId, { data: summaries });
        return;
      }

      // 10. POST /v1/invitations & POST /v1/invitations/accept
      if (method === "POST" && pathname === "/v1/invitations") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const { json: body } = await readRawAndJsonBody(req);
        const organizationId = String(body.organizationId ?? "").trim();
        if (!organizationId) {
          sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "organizationId is required.",
            correlationId
          );
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId,
          allowedRoles: ["partner_owner", "partner_manager"],
        });
        if (!decision.allowed) {
          sendError(
            res,
            403,
            decision.reasonCode,
            "Not authorized to invite members.",
            correlationId
          );
          return;
        }

        const rawToken = String(body.rawToken ?? "");
        const invitationId = body.id ? String(body.id) : crypto.randomUUID();
        const record: StoredInvitationRecord = {
          id: invitationId,
          email: String(body.email ?? ""),
          tokenHash: hashInvitationToken(rawToken),
          expiresAtIso: String(
            body.expiresAtIso ?? new Date(Date.now() + 86400000).toISOString()
          ),
          consumedAtIso: null,
        };
        await deps.repository.saveInvitation({
          ...record,
          organizationId,
          storeId: body.storeId ? String(body.storeId) : null,
          role: body.role ? String(body.role) : "partner_operator",
          invitedBy: actor.id,
        });
        sendJson(res, 201, correlationId, {
          id: record.id,
          email: record.email,
          expiresAtIso: record.expiresAtIso,
        });
        return;
      }

      if (method === "POST" && pathname === "/v1/invitations/accept") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const { json: body } = await readRawAndJsonBody(req);
        const invitationId = String(body.invitationId ?? "");
        const rawToken = String(body.rawToken ?? "");
        const stored = await deps.repository.getInvitationById(invitationId);
        if (!stored) {
          sendError(
            res,
            404,
            "INVITATION_NOT_FOUND",
            "Invitation not found.",
            correlationId
          );
          return;
        }

        const check = validateInvitationAcceptance({
          rawToken,
          actorEmail: actor.email,
          invitation: stored,
        });
        if (!check.valid) {
          sendError(
            res,
            400,
            `INVITATION_${check.reasonCode}`,
            "Invalid or expired invitation.",
            correlationId
          );
          return;
        }

        const consumedAtIso = new Date().toISOString();
        await deps.repository.markInvitationConsumed(
          stored.id,
          consumedAtIso,
          actor.id
        );
        sendJson(res, 200, correlationId, {
          status: "ACCEPTED",
          consumedAtIso,
        });
        return;
      }

      // 11. POST /v1/onboarding/approvals (Requires Internal Staff + MFA aal2)
      if (method === "POST" && pathname === "/v1/onboarding/approvals") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const staffDecision = authorizeStaffAction({
          actor,
          allowedRoles: [
            "operations",
            "commercial",
            "risk_compliance",
            "tech_admin",
          ],
          requireMfaAal2: true,
        });

        if (!staffDecision.allowed) {
          sendError(
            res,
            403,
            staffDecision.reasonCode,
            "Staff role with MFA aal2 step-up is required.",
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const targetId = String(body.targetId ?? "").trim();
        const decision = String(
          body.decision ?? "APPROVED"
        ) as AdminGovernanceActionContract["decision"];
        const targetType = String(
          body.targetType ?? "STORE"
        ) as AdminGovernanceActionContract["targetType"];
        const reason = String(body.reason ?? "").trim();

        if (!targetId || !reason) {
          sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "targetId and reason are required.",
            correlationId
          );
          return;
        }

        const nowIso = new Date().toISOString();
        await deps.repository.saveGovernanceApprovalEvent({
          id: crypto.randomUUID(),
          targetType,
          targetId,
          decision,
          actorId: actor.id,
          reason,
          createdAtIso: nowIso,
        });

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: `ONBOARDING_${decision}`,
          targetType,
          targetId,
          correlationId,
          reason,
          redactedPayload: { decision, targetId },
          createdAt: nowIso,
        });

        sendJson(res, 200, correlationId, {
          status: decision,
          targetId,
          approvedBy: actor.id,
        });
        return;
      }

      // 12. POST /v1/quotes (Authoritative Server-Side Quote in BRL Cents + Snapshot Persistence)
      if (method === "POST" && pathname === "/v1/quotes") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const idempotencyKey =
          (req.headers["x-idempotency-key"] as string | undefined) ??
          `idem_q_${crypto.randomUUID()}`;
        const existingQuote =
          await deps.repository.getQuoteByCustomerIdempotencyKey(
            actor.id,
            idempotencyKey
          );
        if (existingQuote) {
          sendJson(res, 200, correlationId, { data: existingQuote });
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const storeId = String(body.storeId ?? "").trim();
        if (!storeId) {
          sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "storeId is required to create a quote.",
            correlationId
          );
          return;
        }

        const fulfillmentModality = (body.fulfillmentModality ??
          "PLATFORM_DELIVERY") as FulfillmentModality;

        let quoteInputs: QuoteItemInput[] =
          (body.items as QuoteItemInput[]) ?? [];
        let snapshots = quoteInputs.map((item) => ({
          productId: item.productId,
          productNameEn: item.productId,
          productNamePtBr: item.productId,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          addonsUnitPriceCents: item.addonsUnitPriceCents,
          totalLineCents:
            item.quantity * (item.unitPriceCents + item.addonsUnitPriceCents),
          selectedOptions:
            [] as ServerQuoteRecordContract["itemsSnapshot"][number]["selectedOptions"],
        }));

        if (Array.isArray(body.cartItems)) {
          const catalogData = await deps.repository.getStoreCatalog(
            storeId,
            locale
          );
          if (!catalogData) {
            sendError(
              res,
              404,
              "STORE_NOT_FOUND",
              `Store ${storeId} not found.`,
              correlationId
            );
            return;
          }
          const flatProducts: CatalogProductContract[] =
            catalogData.categories.flatMap((cat) => cat.products);
          const validated = validateAndBuildQuoteItems({
            cartItems: body.cartItems as CartItemSelectionContract[],
            catalogProducts: flatProducts,
          });
          quoteInputs = validated.quoteInputs;
          snapshots = validated.snapshots;
        }

        let activePolicy = DEFAULT_BR_PLATFORM_POLICY;
        if (deps.repository.getMerchantContract) {
          const storeMeta = await deps.repository.getStoreById(storeId, locale);
          if (storeMeta?.organizationId) {
            const orgContract = await deps.repository.getMerchantContract(
              storeMeta.organizationId
            );
            if (orgContract && orgContract.effectiveUntilIso === null) {
              activePolicy = {
                platformDeliveryCommissionBps:
                  orgContract.platformDeliveryCommissionBps,
                merchantDeliveryCommissionBps:
                  orgContract.merchantDeliveryCommissionBps,
                pickupCommissionBps: orgContract.pickupCommissionBps,
                serviceFeeBps:
                  orgContract.serviceFeeBps ??
                  DEFAULT_BR_PLATFORM_POLICY.serviceFeeBps,
                serviceFeeCapCents:
                  DEFAULT_BR_PLATFORM_POLICY.serviceFeeCapCents,
              };
            }
          }
        }

        const calc = calculateServerQuoteAndSplit({
          items: quoteInputs,
          fulfillmentModality,
          deliveryFeeCents: Number(body.deliveryFeeCents ?? 690),
          discountCents: Number(body.discountCents ?? 0),
          discountFundedBy:
            (body.discountFundedBy as "PLATFORM" | "MERCHANT" | "NONE") ??
            "NONE",
          minOrderCents: Number(body.minOrderCents ?? 0),
          policy: activePolicy,
        });

        const now = new Date();
        const quoteRecord: ServerQuoteRecordContract & typeof calc = {
          id: body.id ? String(body.id) : crypto.randomUUID(),
          customerId: actor.id,
          storeId,
          addressId: body.addressId ? String(body.addressId) : null,
          fulfillmentModality,
          promotionCode: body.promotionCode ? String(body.promotionCode) : null,
          currencyCode: CURRENCY_CODE,
          ...calc,
          distanceMeters: Number(body.distanceMeters ?? 1420),
          estimatedPrepMinutes: Number(body.estimatedPrepMinutes ?? 25),
          estimatedDeliveryMinutes: fulfillmentModality === "PICKUP" ? 0 : 35,
          itemsSnapshot: snapshots,
          addressSnapshot:
            (body.addressSnapshot as Record<string, unknown>) ?? null,
          idempotencyKey,
          expiresAtIso: String(
            body.expiresAtIso ??
              new Date(now.getTime() + 15 * 60 * 1000).toISOString()
          ),
          consumedAtIso: null,
          createdAtIso: now.toISOString(),
        };

        await deps.repository.saveQuote(quoteRecord);

        sendJson(res, 201, correlationId, { data: quoteRecord });
        return;
      }

      // 13. POST /v1/orders (M10 — Idempotent order creation from unexpired quote)
      if (method === "POST" && pathname === "/v1/orders") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const idempotencyKey = req.headers["x-idempotency-key"] as
          | string
          | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }

        const existingOrder =
          await deps.repository.getOrderByCustomerIdempotencyKey(
            actor.id,
            idempotencyKey
          );
        if (existingOrder) {
          sendJson(res, 200, correlationId, { data: existingOrder });
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const quoteId = String(body.quoteId ?? "").trim();
        const quote = await deps.repository.getQuoteById(quoteId);

        if (!quote) {
          sendError(
            res,
            404,
            "QUOTE_NOT_FOUND",
            `Quote ${quoteId} not found.`,
            correlationId
          );
          return;
        }

        const storeWithOrg = await deps.repository.getStoreById(
          quote.storeId,
          locale
        );
        const resolvedOrgId = body.organizationId
          ? String(body.organizationId)
          : storeWithOrg?.organizationId;
        if (!resolvedOrgId) {
          sendError(
            res,
            400,
            "STORE_ORGANIZATION_NOT_FOUND",
            `Unable to resolve organizationId for store ${quote.storeId}.`,
            correlationId
          );
          return;
        }

        try {
          const orderNum = await deps.repository.nextOrderNumber();
          const created = createOrderFromServerQuote({
            orderId: body.orderId ? String(body.orderId) : crypto.randomUUID(),
            orderNumber: orderNum,
            organizationId: resolvedOrgId,
            quote,
            actorCustomerId: actor.id,
            isStoreCurrentlyOpen: body.isStoreCurrentlyOpen !== false,
            discountFundedBy:
              (body.discountFundedBy as "PLATFORM" | "MERCHANT" | "NONE") ??
              "NONE",
            customerNotes: body.customerNotes
              ? String(body.customerNotes)
              : null,
            idempotencyKey,
          });

          const consumedAtIso = new Date().toISOString();
          await deps.repository.markQuoteConsumed(quote.id, consumedAtIso);
          await deps.repository.saveOrder(created.order, created.initialEvent);

          sendJson(res, 201, correlationId, { data: created.order });
          return;
        } catch (orderErr) {
          const msg =
            orderErr instanceof Error
              ? orderErr.message
              : "Unable to create order";
          sendError(
            res,
            409,
            msg.split(":")[0] ?? "ORDER_CREATION_CONFLICT",
            msg,
            correlationId
          );
          return;
        }
      }

      // 13b. GET /v1/orders/:orderId (M10)
      const orderGetMatch = pathname.match(/^\/v1\/orders\/([^/]+)$/);
      if (method === "GET" && orderGetMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const orderId = orderGetMatch[1] ?? "";
        const order = await deps.repository.getOrderById(orderId);
        if (!order) {
          sendError(
            res,
            404,
            "ORDER_NOT_FOUND",
            `Order ${orderId} not found.`,
            correlationId
          );
          return;
        }
        if (
          order.customerId !== actor.id &&
          actor.organizationMemberships.length === 0 &&
          actor.staffScopes.length === 0
        ) {
          sendError(
            res,
            403,
            "ORDER_FORBIDDEN",
            "Access to order denied.",
            correlationId
          );
          return;
        }
        sendJson(res, 200, correlationId, { data: order });
        return;
      }

      // 13c. POST /v1/orders/:orderId/commands (M10 — Optimistic locking state transitions)
      const orderCmdMatch = pathname.match(/^\/v1\/orders\/([^/]+)\/commands$/);
      if (method === "POST" && orderCmdMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const orderId = orderCmdMatch[1] ?? "";
        const idempotencyKey = req.headers["x-idempotency-key"] as
          | string
          | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }

        const order = await deps.repository.getOrderById(orderId);
        if (!order) {
          sendError(
            res,
            404,
            "ORDER_NOT_FOUND",
            `Order ${orderId} not found.`,
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const command = String(body.command ?? "") as OrderCommandType;
        const expectedVersion = Number(body.expectedVersion ?? 0);
        const actorRole =
          actor.staffScopes.length > 0
            ? "STAFF"
            : actor.organizationMemberships.length > 0
              ? "PARTNER"
              : "CUSTOMER";

        try {
          const result = executeOrderCommand({
            order,
            command,
            expectedVersion,
            actorId: actor.id,
            actorRole,
            idempotencyKey,
            ...(body.reason ? { reason: String(body.reason) } : {}),
          });

          await deps.repository.updateOrderWithEvent(
            result.updatedOrder,
            result.event
          );

          sendJson(res, 200, correlationId, {
            data: {
              order: result.updatedOrder,
              event: result.event,
            },
          });
          return;
        } catch (cmdErr) {
          const msg =
            cmdErr instanceof Error ? cmdErr.message : "Command execution failed";
          const code = msg.split(":")[0] ?? "ORDER_COMMAND_ERROR";
          const status = code === "ORDER_COMMAND_FORBIDDEN" ? 403 : 409;
          sendError(res, status, code, msg, correlationId);
          return;
        }
      }

      // 13d. GET /v1/orders/:orderId/events (M10)
      const orderEventsMatch = pathname.match(/^\/v1\/orders\/([^/]+)\/events$/);
      if (method === "GET" && orderEventsMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const orderId = orderEventsMatch[1] ?? "";
        const evts = await deps.repository.listOrderEvents(orderId);
        sendJson(res, 200, correlationId, { data: evts });
        return;
      }

      // 13e. GET & POST /v1/orders/:orderId/review (M05 / M19 Verified Order Review)
      const orderReviewMatch = pathname.match(/^\/v1\/orders\/([^/]+)\/review$/);
      if (orderReviewMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const orderId = orderReviewMatch[1] ?? "";
        const order = await deps.repository.getOrderById(orderId);
        if (!order) {
          sendError(
            res,
            404,
            "ORDER_NOT_FOUND",
            `Order ${orderId} not found.`,
            correlationId
          );
          return;
        }
        if (method === "GET") {
          const rev = deps.repository.getOrderReview
            ? await deps.repository.getOrderReview(order.id)
            : null;
          sendJson(res, 200, correlationId, { data: rev });
          return;
        }
        if (method === "POST") {
          if (order.customerId !== actor.id) {
            sendError(
              res,
              403,
              "REVIEW_FORBIDDEN",
              "Only the verified customer who placed the order can submit a review.",
              correlationId
            );
            return;
          }
          const { json: body } = await readRawAndJsonBody(req);
          const rating = Number(body.rating);
          if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            sendError(
              res,
              400,
              "VALIDATION_ERROR",
              "rating must be an integer between 1 and 5.",
              correlationId
            );
            return;
          }
          const reviewInput: OrderReviewContract = {
            id: body.id ? String(body.id) : crypto.randomUUID(),
            orderId: order.id,
            storeId: order.storeId,
            customerId: actor.id,
            rating,
            comment: body.comment ? String(body.comment).trim() : null,
            partnerReply: null,
            partnerRepliedAtIso: null,
            moderationStatus: "PUBLISHED",
            createdAtIso: new Date().toISOString(),
          };
          const saved = deps.repository.saveOrderReview
            ? await deps.repository.saveOrderReview(reviewInput)
            : reviewInput;
          sendJson(res, 201, correlationId, { data: saved });
          return;
        }
      }

      // 13f. GET & POST /v1/orders/:orderId/support-cases (M05 / M17 Order Help & Support)
      const orderSupportMatch = pathname.match(
        /^\/v1\/orders\/([^/]+)\/support-cases$/
      );
      if (orderSupportMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const orderId = orderSupportMatch[1] ?? "";
        const order = await deps.repository.getOrderById(orderId);
        if (!order) {
          sendError(
            res,
            404,
            "ORDER_NOT_FOUND",
            `Order ${orderId} not found.`,
            correlationId
          );
          return;
        }
        if (method === "GET") {
          const cases = deps.repository.listOrderSupportCases
            ? await deps.repository.listOrderSupportCases(order.id)
            : [];
          sendJson(res, 200, correlationId, { data: cases });
          return;
        }
        if (method === "POST") {
          const { json: body } = await readRawAndJsonBody(req);
          const subject = String(body.subject ?? "").trim();
          const category = String(body.category ?? "ORDER_ISSUE").trim();
          if (!subject) {
            sendError(
              res,
              400,
              "VALIDATION_ERROR",
              "subject is required to open a support ticket.",
              correlationId
            );
            return;
          }
          const now = new Date();
          const caseInput: Omit<SupportCaseContract, "caseNumber"> = {
            id: body.id ? String(body.id) : crypto.randomUUID(),
            orderId: order.id,
            organizationId: order.organizationId,
            storeId: order.storeId,
            requesterId: actor.id,
            requesterRole: "CUSTOMER",
            category,
            priority: (body.priority as SupportCaseContract["priority"]) ?? "MEDIUM",
            status: "OPEN",
            subject,
            slaDueAtIso: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
            createdAtIso: now.toISOString(),
          };
          const createdCase = deps.repository.createSupportCase
            ? await deps.repository.createSupportCase(caseInput)
            : { ...caseInput, caseNumber: 5000 };
          sendJson(res, 201, correlationId, { data: createdCase });
          return;
        }
      }

      // 14. POST /v1/payments/attempts (M12 — Enforces honest BLOCKED_MISSING_CREDENTIALS when PSP keys are absent)
      if (method === "POST" && pathname === "/v1/payments/attempts") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const idempotencyKey = req.headers["x-idempotency-key"] as
          | string
          | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const orderId = String(body.orderId ?? "");
        const providerCode = String(body.providerCode ?? "stripe");
        const paymentMethod = (body.paymentMethod ?? "PIX") as PaymentMethodCode;

        const order = await deps.repository.getOrderById(orderId);
        if (!order) {
          sendError(
            res,
            404,
            "ORDER_NOT_FOUND",
            `Order ${orderId} not found.`,
            correlationId
          );
          return;
        }

        const providerStatuses = inspectProviderReadiness(env);
        const pspProvider = providerStatuses.find(
          (p) => p.providerCode === providerCode
        );
        if (!pspProvider) {
          sendError(
            res,
            400,
            "UNSUPPORTED_PSP",
            `Unknown PSP ${providerCode}.`,
            correlationId
          );
          return;
        }

        try {
          assertExternalProviderReady({
            providerCode: pspProvider.providerCode,
            status: pspProvider.status,
            missingEnvVars: pspProvider.missingEnvVars,
          });
        } catch (blockedErr) {
          const msg =
            blockedErr instanceof Error
              ? blockedErr.message
              : "PSP provider blocked";
          sendError(
            res,
            503,
            "PSP_PROVIDER_BLOCKED_MISSING_CREDENTIALS",
            msg,
            correlationId
          );
          return;
        }

        const attempt: PaymentAttemptContract = {
          id: crypto.randomUUID(),
          orderId: order.id,
          customerId: actor.id,
          providerCode,
          paymentMethod,
          amountCents: order.totalCents,
          currencyCode: CURRENCY_CODE,
          status: "PENDING",
          externalPaymentId: `ext_${providerCode}_${crypto.randomUUID()}`,
          idempotencyKey,
          isSandbox: true,
          errorCode: null,
          createdAtIso: new Date().toISOString(),
        };
        await deps.repository.savePaymentAttempt(attempt);
        sendJson(res, 201, correlationId, { data: attempt });
        return;
      }

      // 15. POST /v1/refunds (M12 — Enforces MFA aal2, ABAC maxRefundApprovalCents, and captured ceiling)
      if (method === "POST" && pathname === "/v1/refunds") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const idempotencyKey = req.headers["x-idempotency-key"] as
          | string
          | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const orderId = String(body.orderId ?? "").trim();
        const paymentAttemptId = String(body.paymentAttemptId ?? "").trim();
        const amountCents = Number(body.amountCents ?? 0);
        const reason = String(body.reason ?? "").trim();

        if (!orderId || !paymentAttemptId) {
          sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "orderId and paymentAttemptId are required.",
            correlationId
          );
          return;
        }

        const order = await deps.repository.getOrderById(orderId);
        if (!order) {
          sendError(
            res,
            404,
            "ORDER_NOT_FOUND",
            `Order ${orderId} not found.`,
            correlationId
          );
          return;
        }

        const priorRefunds = await deps.repository.listRefundsByOrder(order.id);
        const alreadyRefundedCents = priorRefunds.reduce(
          (sum, r) => sum + r.amountCents,
          0
        );
        const maxCeiling = Math.max(
          0,
          ...actor.staffScopes.map((s) => s.maxRefundApprovalCents)
        );

        try {
          const evalResult = evaluateRefundRequest({
            orderId: order.id,
            capturedAmountCents: order.totalCents,
            alreadyRefundedCents,
            requestedRefundCents: amountCents,
            staffMaxRefundApprovalCents: maxCeiling,
            actorAal: actor.aal,
            reason,
          });

          const refundRecord: RefundRecordContract = {
            id: crypto.randomUUID(),
            orderId: order.id,
            paymentAttemptId,
            amountCents,
            reason,
            requestedBy: actor.id,
            approvedBy: actor.id,
            status: "APPROVED",
            idempotencyKey,
            createdAtIso: new Date().toISOString(),
          };

          const updatedOrder: OrderRecordContract = {
            ...order,
            paymentStatus: evalResult.newPaymentStatus,
            orderStatus:
              evalResult.newPaymentStatus === "REFUNDED"
                ? "REFUNDED"
                : order.orderStatus,
            version: order.version + 1,
            updatedAtIso: new Date().toISOString(),
          };
          await deps.repository.saveRefundAndUpdateOrder(
            refundRecord,
            updatedOrder
          );

          await deps.repository.appendAuditLog({
            id: crypto.randomUUID(),
            actorId: actor.id,
            action: "ORDER_REFUND_APPROVED",
            targetType: "ORDER",
            targetId: order.id,
            correlationId,
            reason,
            redactedPayload: {
              amountCents,
              newPaymentStatus: evalResult.newPaymentStatus,
              reversalLedgerDebitsCents: evalResult.reversalLedgerDebitsCents,
            },
            createdAt: new Date().toISOString(),
          });

          sendJson(res, 201, correlationId, { data: refundRecord });
          return;
        } catch (refErr) {
          const msg =
            refErr instanceof Error ? refErr.message : "Refund rejected";
          const code = msg.split(":")[0] ?? "REFUND_ERROR";
          const status =
            code === "REFUND_MFA_AAL2_REQUIRED" ||
            code === "REFUND_ABAC_LIMIT_EXCEEDED"
              ? 403
              : 409;
          sendError(res, status, code, msg, correlationId);
          return;
        }
      }

      // 16. PATCH /v1/stores/:storeId/settings & PATCH /v1/partner/stores/:storeId (M07 — Partner store pause/unpause, prep time, minOrderCents)
      const storeSettingsMatch =
        pathname.match(/^\/v1\/stores\/([^/]+)\/settings$/) ??
        pathname.match(/^\/v1\/partner\/stores\/([^/]+)$/);
      if (method === "PATCH" && storeSettingsMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const storeId = storeSettingsMatch[1] ?? "";
        const idempotencyKey = req.headers["x-idempotency-key"] as
          | string
          | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const targetStore = await deps.repository.getStoreById(storeId, locale);
        if (!targetStore) {
          sendError(
            res,
            404,
            "STORE_NOT_FOUND",
            `Store ${storeId} not found.`,
            correlationId
          );
          return;
        }

        const organizationId = body.organizationId
          ? String(body.organizationId)
          : targetStore.organizationId;
        const decision = authorizePartnerScope({
          actor,
          organizationId,
          storeId: targetStore.id,
          allowedRoles: ["partner_owner", "partner_manager", "partner_operator"],
        });

        if (!decision.allowed) {
          sendError(
            res,
            403,
            decision.reasonCode,
            "Not authorized to update store settings.",
            correlationId
          );
          return;
        }

        try {
          const patch: StoreSettingsPatchContract = {};
          if (body.name !== undefined) patch.name = String(body.name).trim();
          if (body.descriptionEn !== undefined)
            patch.descriptionEn = String(body.descriptionEn);
          if (body.descriptionPtBr !== undefined)
            patch.descriptionPtBr = String(body.descriptionPtBr);
          if (body.cuisineCategory !== undefined)
            patch.cuisineCategory = String(body.cuisineCategory).trim();
          if (body.isPaused !== undefined) patch.isPaused = Boolean(body.isPaused);
          if (body.pauseReason !== undefined) {
            patch.pauseReason = body.pauseReason
              ? String(body.pauseReason)
              : null;
          }
          if (body.minOrderCents !== undefined)
            patch.minOrderCents = Number(body.minOrderCents);
          if (body.prepTimeMinMinutes !== undefined) {
            patch.prepTimeMinMinutes = Number(body.prepTimeMinMinutes);
          }
          if (body.prepTimeMaxMinutes !== undefined) {
            patch.prepTimeMaxMinutes = Number(body.prepTimeMaxMinutes);
          }
          if (Array.isArray(body.supportedModalities)) {
            patch.supportedModalities =
              body.supportedModalities as FulfillmentModality[];
          }
          validateStoreSettingsPatch(patch);

          const updatedStore = await deps.repository.updateStoreSettings(
            targetStore.id,
            patch,
            locale
          );
          if (!updatedStore) {
            sendError(
              res,
              404,
              "STORE_NOT_FOUND",
              `Store ${storeId} not found.`,
              correlationId
            );
            return;
          }

          await deps.repository.appendAuditLog({
            id: crypto.randomUUID(),
            actorId: actor.id,
            action: "STORE_SETTINGS_UPDATED",
            targetType: "STORE",
            targetId: storeId,
            correlationId,
            reason: patch.pauseReason ?? "Updated store operational settings",
            redactedPayload: {
              isPaused: updatedStore.isPaused,
              minOrderCents: updatedStore.minOrderCents,
              prepTimeMinMinutes: updatedStore.prepTimeMinMinutes,
              prepTimeMaxMinutes: updatedStore.prepTimeMaxMinutes,
            },
            createdAt: new Date().toISOString(),
          });

          sendJson(res, 200, correlationId, { data: updatedStore });
          return;
        } catch (patchErr) {
          const msg =
            patchErr instanceof Error
              ? patchErr.message
              : "Invalid store settings patch";
          sendError(
            res,
            400,
            msg.split(":")[0] ?? "STORE_SETTINGS_ERROR",
            msg,
            correlationId
          );
          return;
        }
      }

      // 17. POST /v1/stores/:storeId/bank-account-change-request (M07 — Requires partner_owner + MFA aal2; PENDING only)
      const bankChangeMatch = pathname.match(
        /^\/v1\/stores\/([^/]+)\/bank-account-change-request$/
      );
      if (method === "POST" && bankChangeMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const storeId = bankChangeMatch[1] ?? "";
        const idempotencyKey = req.headers["x-idempotency-key"] as
          | string
          | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const storeWithOrg = await deps.repository.getStoreById(storeId, locale);
        const organizationId = body.organizationId
          ? String(body.organizationId)
          : (storeWithOrg?.organizationId ?? "");

        const decision = authorizePartnerScope({
          actor,
          organizationId,
          storeId,
          allowedRoles: ["partner_owner"],
          requireMfaAal2: true,
        });

        if (!decision.allowed) {
          sendError(
            res,
            403,
            decision.reasonCode,
            "Only Partner Owner with MFA aal2 can request bank account changes.",
            correlationId
          );
          return;
        }

        try {
          const bankReq = createBankAccountChangeRequest({
            id: crypto.randomUUID(),
            organizationId,
            storeId,
            requestedBy: actor.id,
            actorAal: actor.aal,
            bankCode: String(body.bankCode ?? ""),
            branchNumber: String(body.branchNumber ?? ""),
            accountLast4: String(body.accountLast4 ?? ""),
            reason: String(body.reason ?? ""),
          });
          await deps.repository.saveBankAccountChangeRequest(bankReq);

          await deps.repository.appendAuditLog({
            id: crypto.randomUUID(),
            actorId: actor.id,
            action: "BANK_ACCOUNT_CHANGE_REQUESTED",
            targetType: "BANK_ACCOUNT",
            targetId: storeId,
            correlationId,
            reason: bankReq.reason,
            redactedPayload: {
              bankCode: bankReq.bankCode,
              accountLast4: bankReq.accountLast4,
              status: bankReq.status,
              immediatePayoutTriggered: false,
            },
            createdAt: bankReq.createdAtIso,
          });

          sendJson(res, 201, correlationId, { data: bankReq });
          return;
        } catch (bankErr) {
          const msg =
            bankErr instanceof Error
              ? bankErr.message
              : "Invalid bank change request";
          sendError(
            res,
            400,
            msg.split(":")[0] ?? "BANK_CHANGE_ERROR",
            msg,
            correlationId
          );
          return;
        }
      }

      // 18. GET /v1/stores/:storeId/orders-queue (M08 — Kitchen Order Console Queue with SLA & pause resilience)
      const ordersQueueMatch = pathname.match(
        /^\/v1\/stores\/([^/]+)\/orders-queue$/
      );
      if (method === "GET" && ordersQueueMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const storeId = ordersQueueMatch[1] ?? "";
        const store = await deps.repository.getStoreById(storeId, locale);
        if (!store) {
          sendError(
            res,
            404,
            "STORE_NOT_FOUND",
            `Store ${storeId} not found.`,
            correlationId
          );
          return;
        }

        const organizationId =
          parsedUrl.searchParams.get("organizationId") ?? store.organizationId;

        const decision = authorizePartnerScope({
          actor,
          organizationId,
          storeId,
          allowedRoles: [
            "partner_owner",
            "partner_manager",
            "partner_operator",
            "partner_support",
          ],
        });

        if (!decision.allowed && actor.staffScopes.length === 0) {
          sendError(
            res,
            403,
            decision.reasonCode,
            "Access to store order queue denied.",
            correlationId
          );
          return;
        }

        const storeOrders = await deps.repository.listOrdersByStore(storeId);
        const eventLists = await Promise.all(
          storeOrders.map((o) => deps.repository.listOrderEvents(o.id))
        );
        const allStoreEvents = eventLists.flat();
        const latestEventCursor =
          allStoreEvents.length > 0
            ? (allStoreEvents[allStoreEvents.length - 1]?.id ?? null)
            : null;

        const queue = buildKitchenOrderQueue({
          storeId,
          isStorePaused: store.isPaused,
          orders: storeOrders,
          prepTimeMaxMinutes: store.prepTimeMaxMinutes ?? 35,
          latestEventCursor,
        });

        sendJson(res, 200, correlationId, { data: queue });
        return;
      }

      // 19. POST /v1/admin/staff-scopes (M16 — Enforces tech_admin + MFA aal2 + blocks self-grant)
      if (method === "POST" && pathname === "/v1/admin/staff-scopes") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const idempotencyKey = req.headers["x-idempotency-key"] as
          | string
          | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const grantRequest: AdminStaffScopeGrantRequestContract = {
          targetUserId: String(body.targetUserId ?? ""),
          role: String(body.role ?? "operations") as StaffRole,
          regionCode: body.regionCode ? String(body.regionCode) : null,
          maxRefundApprovalCents: Number(body.maxRefundApprovalCents ?? 0),
          justification: String(body.justification ?? ""),
        };

        const grantEval = evaluateStaffScopeGrant({
          actorId: actor.id,
          actorAal: actor.aal,
          actorRoles: actor.staffScopes.map((s) => s.role),
          request: grantRequest,
        });

        if (!grantEval.allowed) {
          sendError(
            res,
            403,
            grantEval.reasonCode,
            `Staff scope grant denied (${grantEval.reasonCode}).`,
            correlationId
          );
          return;
        }

        await deps.repository.grantStaffScope({
          ...grantRequest,
          grantedBy: actor.id,
        });

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: "STAFF_SCOPE_GRANTED",
          targetType: "STAFF_SCOPE",
          targetId: grantRequest.targetUserId,
          correlationId,
          reason: grantRequest.justification,
          redactedPayload: {
            role: grantRequest.role,
            regionCode: grantRequest.regionCode,
            maxRefundApprovalCents: grantRequest.maxRefundApprovalCents,
          },
          createdAt: new Date().toISOString(),
        });

        sendJson(res, 201, correlationId, {
          data: {
            ...grantRequest,
            grantedBy: actor.id,
          },
        });
        return;
      }

      // 20. POST /v1/admin/governance-actions (M16 — Suspensions, Reactivations & Approvals with MFA aal2)
      if (method === "POST" && pathname === "/v1/admin/governance-actions") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const idempotencyKey = req.headers["x-idempotency-key"] as
          | string
          | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        try {
          const actionRecord = evaluateAdminGovernanceDecision({
            id: crypto.randomUUID(),
            actorId: actor.id,
            actorAal: actor.aal,
            actorRoles: actor.staffScopes.map((s) => s.role),
            targetType: String(
              body.targetType ?? "STORE"
            ) as AdminGovernanceActionContract["targetType"],
            targetId: String(body.targetId ?? ""),
            decision: String(
              body.decision ?? "APPROVED"
            ) as AdminGovernanceActionContract["decision"],
            reason: String(body.reason ?? ""),
          });

          await deps.repository.saveGovernanceApprovalEvent(actionRecord);

          await deps.repository.appendAuditLog({
            id: crypto.randomUUID(),
            actorId: actor.id,
            action: `ADMIN_GOVERNANCE_${actionRecord.decision}`,
            targetType: actionRecord.targetType,
            targetId: actionRecord.targetId,
            correlationId,
            reason: actionRecord.reason,
            redactedPayload: {
              decision: actionRecord.decision,
              targetType: actionRecord.targetType,
            },
            createdAt: actionRecord.createdAtIso,
          });

          sendJson(res, 201, correlationId, { data: actionRecord });
          return;
        } catch (govErr) {
          const msg =
            govErr instanceof Error
              ? govErr.message
              : "Governance action denied";
          const code = msg.split(":")[0] ?? "ADMIN_GOVERNANCE_ERROR";
          const status =
            code.includes("FORBIDDEN") || code.includes("MFA") ? 403 : 400;
          sendError(res, status, code, msg, correlationId);
          return;
        }
      }

      // 21. GET /v1/admin/audit-logs (M16 — Read-Only Audit Trail for Authorized Staff with MFA aal2)
      if (method === "GET" && pathname === "/v1/admin/audit-logs") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const staffDecision = authorizeStaffAction({
          actor,
          allowedRoles: [
            "operations",
            "finance",
            "risk_compliance",
            "tech_admin",
          ],
          requireMfaAal2: true,
        });
        if (!staffDecision.allowed) {
          sendError(
            res,
            403,
            staffDecision.reasonCode,
            "Audit logs require authorized staff role with MFA aal2.",
            correlationId
          );
          return;
        }
        const logs = await deps.repository.getAuditLogs();
        sendJson(res, 200, correlationId, { data: logs });
        return;
      }

      // 22. POST /v1/finance/reconciliation-runs (M13 — PSP Reconciliation in BRL cents; requires finance/tech_admin + MFA aal2)
      if (method === "POST" && pathname === "/v1/finance/reconciliation-runs") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const idempotencyKey = req.headers["x-idempotency-key"] as
          | string
          | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }

        const staffDecision = authorizeStaffAction({
          actor,
          allowedRoles: ["finance", "tech_admin"],
          requireMfaAal2: true,
        });
        if (!staffDecision.allowed) {
          sendError(
            res,
            403,
            staffDecision.reasonCode,
            "PSP reconciliation requires finance or tech_admin role with MFA aal2.",
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const runResult = evaluatePspReconciliationRun({
          runId: crypto.randomUUID(),
          providerCode: String(body.providerCode ?? "stripe"),
          runDate: String(body.runDate ?? new Date().toISOString().slice(0, 10)),
          expectedOrders:
            (body.expectedOrders as Array<{
              orderId: string;
              totalCents: number;
            }>) ?? [],
          pspReportedCaptures:
            (body.pspReportedCaptures as Array<{
              orderId: string;
              capturedCents: number;
            }>) ?? [],
        });

        await deps.repository.saveReconciliationRun(runResult);

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: "PSP_RECONCILIATION_RUN_COMPLETED",
          targetType: "RECONCILIATION_RUN",
          targetId: runResult.id,
          correlationId,
          reason: `Reconciled ${runResult.matchedCount} matched, ${runResult.discrepancyCount} discrepancies`,
          redactedPayload: {
            providerCode: runResult.providerCode,
            matchedCount: runResult.matchedCount,
            discrepancyCount: runResult.discrepancyCount,
            discrepancyTotalCents: runResult.discrepancyTotalCents,
          },
          createdAt: runResult.createdAtIso,
        });

        sendJson(res, 201, correlationId, { data: runResult });
        return;
      }

      // 23. POST /v1/finance/settlements/:settlementId/execute (M13 — Payout execution with Segregation of Duties & BLOCKED_NO_PSP)
      const settlementExecMatch = pathname.match(
        /^\/v1\/finance\/settlements\/([^/]+)\/execute$/
      );
      if (method === "POST" && settlementExecMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const settlementId = settlementExecMatch[1] ?? "";
        const idempotencyKey = req.headers["x-idempotency-key"] as
          | string
          | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const providerCode = String(body.providerCode ?? "stripe");
        const providerStatuses = inspectProviderReadiness(env);
        const pspProvider = providerStatuses.find(
          (p) => p.providerCode === providerCode
        );
        const pspStatus = pspProvider?.status ?? "BLOCKED_MISSING_CREDENTIALS";

        const storedSettlement =
          await deps.repository.getSettlementById(settlementId);
        if (
          !storedSettlement &&
          !body.organizationId &&
          !body.courierId &&
          !body.bankAccountApprovedByActorId
        ) {
          sendError(
            res,
            404,
            "SETTLEMENT_NOT_FOUND",
            `Settlement ${settlementId} not found.`,
            correlationId
          );
          return;
        }

        const existingSettlement: SettlementRecordContract =
          storedSettlement ?? {
            id: settlementId,
            organizationId: body.organizationId
              ? String(body.organizationId)
              : null,
            courierId: body.courierId ? String(body.courierId) : null,
            periodStart: String(
              body.periodStart ?? new Date().toISOString().slice(0, 10)
            ),
            periodEnd: String(
              body.periodEnd ?? new Date().toISOString().slice(0, 10)
            ),
            amountCents: Number(body.amountCents ?? 0),
            status: "SCHEDULED",
            approvedBy: null,
            externalPayoutReference: null,
            createdAtIso: new Date().toISOString(),
          };

        try {
          const updatedSettlement = evaluateSettlementPayoutExecution({
            settlement: existingSettlement,
            actorId: actor.id,
            actorAal: actor.aal,
            actorRoles: actor.staffScopes.map((s) => s.role),
            bankAccountApprovedByActorId: body.bankAccountApprovedByActorId
              ? String(body.bankAccountApprovedByActorId)
              : null,
            pspProviderStatus: pspStatus,
            externalPayoutReference: body.externalPayoutReference
              ? String(body.externalPayoutReference)
              : null,
          });
          await deps.repository.saveSettlement(updatedSettlement);

          await deps.repository.appendAuditLog({
            id: crypto.randomUUID(),
            actorId: actor.id,
            action: `SETTLEMENT_PAYOUT_${updatedSettlement.status}`,
            targetType: "SETTLEMENT",
            targetId: settlementId,
            correlationId,
            reason: `Settlement payout evaluated with status ${updatedSettlement.status}`,
            redactedPayload: {
              amountCents: updatedSettlement.amountCents,
              status: updatedSettlement.status,
              externalPayoutReference:
                updatedSettlement.externalPayoutReference,
            },
            createdAt: new Date().toISOString(),
          });

          sendJson(res, 200, correlationId, { data: updatedSettlement });
          return;
        } catch (settleErr) {
          const msg =
            settleErr instanceof Error
              ? settleErr.message
              : "Settlement execution denied";
          const code = msg.split(":")[0] ?? "SETTLEMENT_ERROR";
          const status =
            code.includes("FORBIDDEN") ||
            code.includes("MFA") ||
            code.includes("SEGREGATION_OF_DUTIES")
              ? 403
              : 400;
          sendError(res, status, code, msg, correlationId);
          return;
        }
      }

      // 24. POST /v1/logistics/offers (M14 — Create delivery task & courier offer with neighborhood-only privacy)
      if (method === "POST" && pathname === "/v1/logistics/offers") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const dispatchDecision = authorizeStaffAction({
          actor,
          allowedRoles: ["operations", "tech_admin"],
          requireMfaAal2: false,
        });
        if (!dispatchDecision.allowed) {
          sendError(
            res,
            403,
            dispatchDecision.reasonCode,
            "Only logistics operations staff can create delivery offers.",
            correlationId
          );
          return;
        }
        const { json: body } = await readRawAndJsonBody(req);
        const taskId = body.deliveryTaskId
          ? String(body.deliveryTaskId)
          : crypto.randomUUID();
        const offerId = body.offerId ? String(body.offerId) : crypto.randomUUID();
        const fullAddress = String(body.dropoffFullAddress ?? "").trim();
        const dropoffNeighborhoodOnly = String(
          body.dropoffNeighborhoodOnly ?? ""
        ).trim();
        const confirmationCode = String(body.confirmationCode ?? "").trim();

        if (!fullAddress || !dropoffNeighborhoodOnly || !confirmationCode) {
          sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "dropoffFullAddress, dropoffNeighborhoodOnly, and confirmationCode are required.",
            correlationId
          );
          return;
        }

        const existingTaskBundle =
          await deps.repository.getDeliveryTaskById(taskId);
        const stores = await deps.repository.listPublishedStores(locale);
        const resolvedStore = body.storeId
          ? await deps.repository.getStoreById(String(body.storeId), locale)
          : (stores[0] ?? null);
        if (!resolvedStore) {
          sendError(
            res,
            404,
            "STORE_NOT_FOUND",
            "Target store for delivery task not found.",
            correlationId
          );
          return;
        }

        const task: DeliveryTaskContract = existingTaskBundle?.task ?? {
          id: taskId,
          orderId: body.orderId ? String(body.orderId) : crypto.randomUUID(),
          storeId: resolvedStore.id,
          fulfillmentModality: "PLATFORM_DELIVERY",
          status: "OFFERING",
          pickupLatitude: Number(
            body.pickupLatitude ?? resolvedStore.latitude ?? 0
          ),
          pickupLongitude: Number(
            body.pickupLongitude ?? resolvedStore.longitude ?? 0
          ),
          dropoffLatitude: Number(body.dropoffLatitude ?? -23.56398),
          dropoffLongitude: Number(body.dropoffLongitude ?? -46.66912),
          dropoffNeighborhoodOnly,
          dropoffFullAddress: null, // Hidden until accepted!
          courierFeeCents: Number(body.offeredFeeCents ?? 850),
          distanceMeters: Number(body.distanceMeters ?? 1420),
          estimatedEtaMinutes: Number(body.estimatedEtaMinutes ?? 18),
          activeCourierId: null,
          pickedUpAtIso: null,
          completedAtIso: null,
          createdAtIso: new Date().toISOString(),
        };

        const offer: DeliveryOfferContract = {
          id: offerId,
          deliveryTaskId: task.id,
          courierId: String(body.courierId ?? actor.id),
          offeredFeeCents: Number(body.offeredFeeCents ?? 850),
          status: "OFFERED",
          pickupStoreName: body.pickupStoreName
            ? String(body.pickupStoreName)
            : resolvedStore.name,
          distanceMeters: task.distanceMeters,
          dropoffNeighborhoodOnly: task.dropoffNeighborhoodOnly,
          expiresAtIso: String(
            body.expiresAtIso ?? new Date(Date.now() + 60 * 1000).toISOString()
          ),
          respondedAtIso: null,
        };

        await deps.repository.saveDeliveryTaskAndOffer({
          task,
          fullAddress,
          confirmationCodeHash: hashDeliveryConfirmationCode(confirmationCode),
          offer,
        });

        sendJson(res, 201, correlationId, { data: { offer, task } });
        return;
      }

      // 25. POST /v1/logistics/offers/:offerId/accept (M14/M11 — Transactional single-courier assignment & address reveal)
      const offerAcceptMatch = pathname.match(
        /^\/v1\/logistics\/offers\/([^/]+)\/accept$/
      );
      if (method === "POST" && offerAcceptMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const offerId = offerAcceptMatch[1] ?? "";
        const idempotencyKey = req.headers["x-idempotency-key"] as
          | string
          | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }

        const offer = await deps.repository.getDeliveryOfferById(offerId);
        if (!offer) {
          sendError(
            res,
            404,
            "DELIVERY_OFFER_NOT_FOUND",
            `Offer ${offerId} not found.`,
            correlationId
          );
          return;
        }
        const taskBundle = await deps.repository.getDeliveryTaskById(
          offer.deliveryTaskId
        );
        if (!taskBundle || !taskBundle.fullAddress) {
          sendError(
            res,
            404,
            "DELIVERY_TASK_NOT_FOUND",
            `Task ${offer.deliveryTaskId} not found.`,
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);

        try {
          const accepted = acceptDeliveryOfferTransactional({
            offer,
            task: taskBundle.task,
            actorCourierId: actor.id,
            isCourierOnline: body.isCourierOnline !== false,
            fullCustomerAddress: taskBundle.fullAddress,
          });
          await deps.repository.saveAcceptedDeliveryOffer({
            offer: accepted.updatedOffer,
            task: accepted.updatedTask,
            fullAddress: taskBundle.fullAddress,
          });

          sendJson(res, 200, correlationId, {
            data: {
              offer: accepted.updatedOffer,
              task: accepted.updatedTask,
            },
          });
          return;
        } catch (acceptErr) {
          const msg =
            acceptErr instanceof Error
              ? acceptErr.message
              : "Offer acceptance failed";
          const code = msg.split(":")[0] ?? "DELIVERY_OFFER_ERROR";
          const status = code === "DELIVERY_OFFER_FORBIDDEN" ? 403 : 409;
          sendError(res, status, code, msg, correlationId);
          return;
        }
      }

      // 26. POST /v1/logistics/location-samples (M14/M11 — GPS telemetry validation with staleness & accuracy flags)
      if (method === "POST" && pathname === "/v1/logistics/location-samples") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const idempotencyKey = req.headers["x-idempotency-key"] as
          | string
          | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const deliveryTaskId = body.deliveryTaskId
          ? String(body.deliveryTaskId)
          : null;
        const taskBundle = deliveryTaskId
          ? await deps.repository.getDeliveryTaskById(deliveryTaskId)
          : null;
        if (deliveryTaskId && !taskBundle) {
          sendError(
            res,
            404,
            "DELIVERY_TASK_NOT_FOUND",
            `Task ${deliveryTaskId} not found.`,
            correlationId
          );
          return;
        }

        try {
          const sample = evaluateCourierLocationSample({
            sampleId: crypto.randomUUID(),
            courierId: actor.id,
            deliveryTaskId,
            activeCourierIdForTask: taskBundle
              ? taskBundle.task.activeCourierId
              : null,
            latitude: Number(body.latitude ?? 0),
            longitude: Number(body.longitude ?? 0),
            accuracyMeters: Number(body.accuracyMeters ?? 10),
            recordedAtIso: String(
              body.recordedAtIso ?? new Date().toISOString()
            ),
          });
          await deps.repository.saveCourierLocationSample(sample);
          sendJson(res, 201, correlationId, { data: sample });
          return;
        } catch (locErr) {
          const msg =
            locErr instanceof Error
              ? locErr.message
              : "Invalid location sample";
          const code = msg.split(":")[0] ?? "LOCATION_SAMPLE_ERROR";
          const status = code.includes("FORBIDDEN") ? 403 : 400;
          sendError(res, status, code, msg, correlationId);
          return;
        }
      }

      // 27. POST /v1/logistics/tasks/:taskId/complete (M14/M11 — Proof-of-Delivery 4-digit OTP Verification)
      const taskCompleteMatch = pathname.match(
        /^\/v1\/logistics\/tasks\/([^/]+)\/complete$/
      );
      if (method === "POST" && taskCompleteMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const taskId = taskCompleteMatch[1] ?? "";
        const idempotencyKey = req.headers["x-idempotency-key"] as
          | string
          | undefined;
        if (!idempotencyKey || idempotencyKey.trim().length < 8) {
          sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Header X-Idempotency-Key is required.",
            correlationId
          );
          return;
        }

        const taskBundle = await deps.repository.getDeliveryTaskById(taskId);
        if (!taskBundle) {
          sendError(
            res,
            404,
            "DELIVERY_TASK_NOT_FOUND",
            `Task ${taskId} not found.`,
            correlationId
          );
          return;
        }
        const { task, confirmationCodeHash } = taskBundle;

        const isLogisticsStaff = authorizeStaffAction({
          actor,
          allowedRoles: ["operations", "tech_admin"],
          requireMfaAal2: false,
        }).allowed;
        if (task.activeCourierId !== actor.id && !isLogisticsStaff) {
          sendError(
            res,
            403,
            "DELIVERY_TASK_FORBIDDEN",
            "Only the assigned courier or logistics staff can complete this task.",
            correlationId
          );
          return;
        }
        if (task.status === "DELIVERED" || task.completedAtIso !== null) {
          sendError(
            res,
            409,
            "DELIVERY_TASK_ALREADY_COMPLETED",
            `Task ${taskId} was already completed.`,
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const candidateOtp = String(body.confirmationCode ?? "");
        if (!confirmationCodeHash) {
          sendError(
            res,
            409,
            "DELIVERY_OTP_NOT_SET",
            "Delivery task does not have an OTP hash configured.",
            correlationId
          );
          return;
        }

        const otpValid = verifyDeliveryConfirmationCode({
          providedCode: candidateOtp,
          expectedCodeHash: confirmationCodeHash,
        });
        if (!otpValid) {
          sendError(
            res,
            409,
            "DELIVERY_OTP_MISMATCH",
            "Invalid 4-digit delivery confirmation code.",
            correlationId
          );
          return;
        }

        const updatedTask: DeliveryTaskContract = {
          ...task,
          status: "DELIVERED",
          completedAtIso: new Date().toISOString(),
        };
        await deps.repository.completeDeliveryTask(updatedTask);

        sendJson(res, 200, correlationId, { data: updatedTask });
        return;
      }

      // ======================================================================
      // FASE F: M04 / M07 / M09 / M02 Store Detail, Hours, Service Areas,
      //         Catalog CRUD (Categories, Products, Option Groups, Options)
      //         & Signed Storage Upload URLs
      // ======================================================================

      // 26. GET /v1/stores/:storeId (M04 — Public Store Detail by ID or Slug + Active Catalog + Availability + Service Areas)
      const publicStoreDetailMatch = pathname.match(/^\/v1\/stores\/([^/]+)$/);
      if (method === "GET" && publicStoreDetailMatch) {
        const storeIdOrSlug = publicStoreDetailMatch[1] ?? "";
        const catalogData = await deps.repository.getStoreCatalog(
          storeIdOrSlug,
          locale
        );
        if (!catalogData) {
          sendError(
            res,
            404,
            "STORE_NOT_FOUND",
            `Published store ${storeIdOrSlug} not found.`,
            correlationId
          );
          return;
        }

        const availability = evaluateStoreAvailability({
          storeId: catalogData.store.id,
          isPublished: true,
          isPaused: catalogData.store.isPaused,
          weeklyHours: catalogData.weeklyHours,
          exceptions: catalogData.exceptions,
        });

        const payload: StoreDetailResponseContract = {
          store: catalogData.store,
          availability,
          categories: catalogData.categories,
          serviceAreas: catalogData.serviceAreas,
          hours: catalogData.weeklyHours,
          exceptions: catalogData.exceptions,
        };
        sendJson(res, 200, correlationId, { data: payload });
        return;
      }

      // 27. GET / PUT /v1/partner/stores/:storeId/hours (M07 — Store Weekly Operating Hours)
      const partnerHoursMatch = pathname.match(
        /^\/v1\/partner\/stores\/([^/]+)\/hours$/
      );
      if (partnerHoursMatch && (method === "GET" || method === "PUT")) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const storeId = partnerHoursMatch[1] ?? "";
        const targetStore = await deps.repository.getStoreById(storeId, locale);
        if (!targetStore) {
          sendError(res, 404, "STORE_NOT_FOUND", `Store ${storeId} not found.`, correlationId);
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: targetStore.organizationId,
          storeId: targetStore.id,
          allowedRoles:
            method === "GET"
              ? ["partner_owner", "partner_manager", "partner_operator", "partner_catalog"]
              : ["partner_owner", "partner_manager"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to manage store operating hours.", correlationId);
          return;
        }

        if (method === "GET") {
          const catalogData = await deps.repository.getStoreCatalog(targetStore.id, locale);
          sendJson(res, 200, correlationId, {
            data: {
              hours: catalogData?.weeklyHours ?? [],
              exceptions: catalogData?.exceptions ?? [],
            },
          });
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        if (!Array.isArray(body.hours)) {
          sendError(res, 400, "VALIDATION_ERROR", "hours array is required.", correlationId);
          return;
        }

        const timeRegex = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
        const normalizedHours: StoreOperatingHourContract[] = [];
        for (const raw of body.hours as Array<Record<string, unknown>>) {
          const dayOfWeek = Number(raw.dayOfWeek);
          const opensAt = String(raw.opensAt ?? "").trim();
          const closesAt = String(raw.closesAt ?? "").trim();
          if (
            !Number.isInteger(dayOfWeek) ||
            dayOfWeek < 0 ||
            dayOfWeek > 6 ||
            !timeRegex.test(opensAt) ||
            !timeRegex.test(closesAt)
          ) {
            sendError(
              res,
              400,
              "INVALID_STORE_HOURS",
              "dayOfWeek must be 0..6 and opensAt/closesAt must be valid HH:mm or HH:mm:ss times.",
              correlationId
            );
            return;
          }
          normalizedHours.push({
            dayOfWeek,
            opensAt: opensAt.length === 5 ? `${opensAt}:00` : opensAt,
            closesAt: closesAt.length === 5 ? `${closesAt}:00` : closesAt,
            isOvernight: Boolean(raw.isOvernight),
            isClosed: Boolean(raw.isClosed),
          });
        }

        const savedHours = await deps.repository.replaceStoreOperatingHours(
          targetStore.id,
          normalizedHours
        );
        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: "STORE_OPERATING_HOURS_UPDATED",
          targetType: "STORE",
          targetId: targetStore.id,
          correlationId,
          reason: "Updated weekly operating hours",
          redactedPayload: { count: savedHours.length },
          createdAt: new Date().toISOString(),
        });

        sendJson(res, 200, correlationId, { data: savedHours });
        return;
      }

      // 28. POST /v1/partner/stores/:storeId/hour-exceptions & DELETE /v1/partner/stores/:storeId/hour-exceptions/:exceptionDate (M07)
      const partnerExcPostMatch = pathname.match(
        /^\/v1\/partner\/stores\/([^/]+)\/hour-exceptions$/
      );
      if (method === "POST" && partnerExcPostMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const storeId = partnerExcPostMatch[1] ?? "";
        const targetStore = await deps.repository.getStoreById(storeId, locale);
        if (!targetStore) {
          sendError(res, 404, "STORE_NOT_FOUND", `Store ${storeId} not found.`, correlationId);
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: targetStore.organizationId,
          storeId: targetStore.id,
          allowedRoles: ["partner_owner", "partner_manager"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to manage store hour exceptions.", correlationId);
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const exceptionDate = String(body.exceptionDate ?? "").trim();
        const reason = String(body.reason ?? "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(exceptionDate) || !reason) {
          sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "exceptionDate (YYYY-MM-DD) and reason are required.",
            correlationId
          );
          return;
        }

        const savedExc = await deps.repository.upsertStoreHourException(targetStore.id, {
          exceptionDate,
          isClosed: body.isClosed !== undefined ? Boolean(body.isClosed) : true,
          opensAt: body.opensAt ? String(body.opensAt) : null,
          closesAt: body.closesAt ? String(body.closesAt) : null,
          reason,
        });

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: "STORE_HOUR_EXCEPTION_UPSERTED",
          targetType: "STORE",
          targetId: targetStore.id,
          correlationId,
          reason,
          redactedPayload: { exceptionDate, isClosed: savedExc.isClosed },
          createdAt: new Date().toISOString(),
        });

        sendJson(res, 201, correlationId, { data: savedExc });
        return;
      }

      const partnerExcDeleteMatch = pathname.match(
        /^\/v1\/partner\/stores\/([^/]+)\/hour-exceptions\/([^/]+)$/
      );
      if (method === "DELETE" && partnerExcDeleteMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const storeId = partnerExcDeleteMatch[1] ?? "";
        const exceptionDate = partnerExcDeleteMatch[2] ?? "";
        const targetStore = await deps.repository.getStoreById(storeId, locale);
        if (!targetStore) {
          sendError(res, 404, "STORE_NOT_FOUND", `Store ${storeId} not found.`, correlationId);
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: targetStore.organizationId,
          storeId: targetStore.id,
          allowedRoles: ["partner_owner", "partner_manager"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to delete store hour exceptions.", correlationId);
          return;
        }

        const deleted = await deps.repository.deleteStoreHourException(
          targetStore.id,
          exceptionDate
        );
        if (!deleted) {
          sendError(res, 404, "EXCEPTION_NOT_FOUND", `Exception ${exceptionDate} not found.`, correlationId);
          return;
        }
        sendJson(res, 200, correlationId, { deleted: true, exceptionDate });
        return;
      }

      // 29. GET / POST / PATCH / DELETE /v1/partner/stores/:storeId/service-areas (M04 / M07)
      const partnerAreasCollectionMatch = pathname.match(
        /^\/v1\/partner\/stores\/([^/]+)\/service-areas$/
      );
      if (partnerAreasCollectionMatch && (method === "GET" || method === "POST")) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const storeId = partnerAreasCollectionMatch[1] ?? "";
        const targetStore = await deps.repository.getStoreById(storeId, locale);
        if (!targetStore) {
          sendError(res, 404, "STORE_NOT_FOUND", `Store ${storeId} not found.`, correlationId);
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: targetStore.organizationId,
          storeId: targetStore.id,
          allowedRoles:
            method === "GET"
              ? ["partner_owner", "partner_manager", "partner_operator"]
              : ["partner_owner", "partner_manager"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to manage service areas.", correlationId);
          return;
        }

        if (method === "GET") {
          const catalogData = await deps.repository.getStoreCatalog(targetStore.id, locale);
          sendJson(res, 200, correlationId, { data: catalogData?.serviceAreas ?? [] });
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const name = String(body.name ?? "").trim();
        const radiusMeters = Number(body.radiusMeters ?? 0);
        const baseFeeCents = Number(body.baseFeeCents ?? -1);
        const perKmFeeCents = Number(body.perKmFeeCents ?? 0);
        const estimatedDeliveryMinutes = Number(body.estimatedDeliveryMinutes ?? 35);
        const freeDeliveryMinOrderCents =
          body.freeDeliveryMinOrderCents !== undefined &&
          body.freeDeliveryMinOrderCents !== null
            ? Number(body.freeDeliveryMinOrderCents)
            : null;

        if (
          !name ||
          !Number.isInteger(radiusMeters) ||
          radiusMeters < 500 ||
          radiusMeters > 50000 ||
          !Number.isInteger(baseFeeCents) ||
          baseFeeCents < 0 ||
          !Number.isInteger(perKmFeeCents) ||
          perKmFeeCents < 0 ||
          !Number.isInteger(estimatedDeliveryMinutes) ||
          estimatedDeliveryMinutes < 5 ||
          estimatedDeliveryMinutes > 240
        ) {
          sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "Invalid service area parameters (radiusMeters 500..50000, non-negative integer cents, estimatedDeliveryMinutes 5..240).",
            correlationId
          );
          return;
        }

        const createdArea = await deps.repository.createStoreServiceArea({
          id: body.id ? String(body.id) : crypto.randomUUID(),
          storeId: targetStore.id,
          name,
          radiusMeters,
          baseFeeCents,
          perKmFeeCents,
          freeDeliveryMinOrderCents,
          estimatedDeliveryMinutes,
          isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
        });

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: "STORE_SERVICE_AREA_CREATED",
          targetType: "STORE",
          targetId: targetStore.id,
          correlationId,
          reason: `Created service area ${name}`,
          redactedPayload: {
            areaId: createdArea.id,
            radiusMeters,
            baseFeeCents,
          },
          createdAt: new Date().toISOString(),
        });

        sendJson(res, 201, correlationId, { data: createdArea });
        return;
      }

      const partnerAreaItemMatch = pathname.match(
        /^\/v1\/partner\/stores\/([^/]+)\/service-areas\/([^/]+)$/
      );
      if (partnerAreaItemMatch && (method === "PATCH" || method === "DELETE")) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const storeId = partnerAreaItemMatch[1] ?? "";
        const areaId = partnerAreaItemMatch[2] ?? "";
        const targetStore = await deps.repository.getStoreById(storeId, locale);
        if (!targetStore) {
          sendError(res, 404, "STORE_NOT_FOUND", `Store ${storeId} not found.`, correlationId);
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: targetStore.organizationId,
          storeId: targetStore.id,
          allowedRoles: ["partner_owner", "partner_manager"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to modify service areas.", correlationId);
          return;
        }

        if (method === "DELETE") {
          const deleted = await deps.repository.deleteStoreServiceArea(targetStore.id, areaId);
          if (!deleted) {
            sendError(res, 404, "SERVICE_AREA_NOT_FOUND", `Service area ${areaId} not found.`, correlationId);
            return;
          }
          sendJson(res, 200, correlationId, { deleted: true, id: areaId });
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const patch: Partial<Omit<StoreServiceAreaContract, "id" | "storeId">> = {};
        if (body.name !== undefined) patch.name = String(body.name).trim();
        if (body.radiusMeters !== undefined) patch.radiusMeters = Number(body.radiusMeters);
        if (body.baseFeeCents !== undefined)
          patch.baseFeeCents = assertIntegerCents(Number(body.baseFeeCents), "baseFeeCents");
        if (body.perKmFeeCents !== undefined)
          patch.perKmFeeCents = assertIntegerCents(Number(body.perKmFeeCents), "perKmFeeCents");
        if (body.freeDeliveryMinOrderCents !== undefined) {
          patch.freeDeliveryMinOrderCents =
            body.freeDeliveryMinOrderCents !== null
              ? assertIntegerCents(
                  Number(body.freeDeliveryMinOrderCents),
                  "freeDeliveryMinOrderCents"
                )
              : null;
        }
        if (body.estimatedDeliveryMinutes !== undefined) {
          patch.estimatedDeliveryMinutes = Number(body.estimatedDeliveryMinutes);
        }
        if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);

        const updatedArea = await deps.repository.updateStoreServiceArea(
          targetStore.id,
          areaId,
          patch
        );
        if (!updatedArea) {
          sendError(res, 404, "SERVICE_AREA_NOT_FOUND", `Service area ${areaId} not found.`, correlationId);
          return;
        }
        sendJson(res, 200, correlationId, { data: updatedArea });
        return;
      }

      // 30. GET / POST / PATCH / DELETE /v1/partner/stores/:storeId/categories (M04 / M07)
      const partnerCategoriesCollectionMatch = pathname.match(
        /^\/v1\/partner\/stores\/([^/]+)\/categories$/
      );
      if (partnerCategoriesCollectionMatch && (method === "GET" || method === "POST")) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const storeId = partnerCategoriesCollectionMatch[1] ?? "";
        const targetStore = await deps.repository.getStoreById(storeId, locale);
        if (!targetStore) {
          sendError(res, 404, "STORE_NOT_FOUND", `Store ${storeId} not found.`, correlationId);
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: targetStore.organizationId,
          storeId: targetStore.id,
          allowedRoles:
            method === "GET"
              ? ["partner_owner", "partner_manager", "partner_catalog", "partner_operator"]
              : ["partner_owner", "partner_manager", "partner_catalog"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to manage catalog categories.", correlationId);
          return;
        }

        if (method === "GET") {
          const catalogData = await deps.repository.getStoreCatalog(targetStore.id, locale);
          sendJson(res, 200, correlationId, { data: catalogData?.categories ?? [] });
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const nameEn = String(body.nameEn ?? "").trim();
        const namePtBr = String(body.namePtBr ?? "").trim();
        if (!nameEn || !namePtBr) {
          sendError(res, 400, "VALIDATION_ERROR", "nameEn and namePtBr are required.", correlationId);
          return;
        }

        const createdCat = await deps.repository.createCatalogCategory(
          targetStore.id,
          {
            ...(body.id ? { id: String(body.id) } : {}),
            nameEn,
            namePtBr,
            sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : 0,
            isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
          },
          locale
        );

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: "CATALOG_CATEGORY_CREATED",
          targetType: "CATALOG_CATEGORY",
          targetId: createdCat.id,
          correlationId,
          reason: `Created category ${nameEn}`,
          redactedPayload: { storeId: targetStore.id, nameEn, namePtBr },
          createdAt: new Date().toISOString(),
        });

        sendJson(res, 201, correlationId, { data: createdCat });
        return;
      }

      const partnerCategoryItemMatch = pathname.match(
        /^\/v1\/partner\/stores\/([^/]+)\/categories\/([^/]+)$/
      );
      if (partnerCategoryItemMatch && (method === "PATCH" || method === "DELETE")) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const storeId = partnerCategoryItemMatch[1] ?? "";
        const categoryId = partnerCategoryItemMatch[2] ?? "";
        const targetStore = await deps.repository.getStoreById(storeId, locale);
        if (!targetStore) {
          sendError(res, 404, "STORE_NOT_FOUND", `Store ${storeId} not found.`, correlationId);
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: targetStore.organizationId,
          storeId: targetStore.id,
          allowedRoles: ["partner_owner", "partner_manager", "partner_catalog"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to modify catalog categories.", correlationId);
          return;
        }

        if (method === "DELETE") {
          const deleted = await deps.repository.deleteCatalogCategory(targetStore.id, categoryId);
          if (!deleted) {
            sendError(res, 404, "CATEGORY_NOT_FOUND", `Category ${categoryId} not found.`, correlationId);
            return;
          }
          sendJson(res, 200, correlationId, { deleted: true, id: categoryId });
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const patch: Partial<CatalogCategoryUpsertContract> = {};
        if (body.nameEn !== undefined) patch.nameEn = String(body.nameEn).trim();
        if (body.namePtBr !== undefined) patch.namePtBr = String(body.namePtBr).trim();
        if (body.sortOrder !== undefined) patch.sortOrder = Number(body.sortOrder);
        if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);

        const updatedCat = await deps.repository.updateCatalogCategory(
          targetStore.id,
          categoryId,
          patch,
          locale
        );
        if (!updatedCat) {
          sendError(res, 404, "CATEGORY_NOT_FOUND", `Category ${categoryId} not found.`, correlationId);
          return;
        }
        sendJson(res, 200, correlationId, { data: updatedCat });
        return;
      }

      // 31. GET / POST / PATCH / DELETE /v1/partner/stores/:storeId/products (M04 / M07)
      const partnerProductsCollectionMatch = pathname.match(
        /^\/v1\/partner\/stores\/([^/]+)\/products$/
      );
      if (partnerProductsCollectionMatch && (method === "GET" || method === "POST")) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const storeId = partnerProductsCollectionMatch[1] ?? "";
        const targetStore = await deps.repository.getStoreById(storeId, locale);
        if (!targetStore) {
          sendError(res, 404, "STORE_NOT_FOUND", `Store ${storeId} not found.`, correlationId);
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: targetStore.organizationId,
          storeId: targetStore.id,
          allowedRoles:
            method === "GET"
              ? ["partner_owner", "partner_manager", "partner_catalog", "partner_operator"]
              : ["partner_owner", "partner_manager", "partner_catalog"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to manage catalog products.", correlationId);
          return;
        }

        if (method === "GET") {
          const catalogData = await deps.repository.getStoreCatalog(targetStore.id, locale);
          const allProducts = (catalogData?.categories ?? []).flatMap((c) => c.products);
          sendJson(res, 200, correlationId, { data: allProducts });
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const categoryId = String(body.categoryId ?? "").trim();
        const nameEn = String(body.nameEn ?? "").trim();
        const namePtBr = String(body.namePtBr ?? "").trim();
        const rawPriceCents = Number(body.priceCents ?? -1);
        if (
          !categoryId ||
          !nameEn ||
          !namePtBr ||
          !Number.isSafeInteger(rawPriceCents) ||
          rawPriceCents < 0
        ) {
          sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "categoryId, nameEn, namePtBr, and non-negative integer priceCents are required.",
            correlationId
          );
          return;
        }

        const createdProd = await deps.repository.createCatalogProduct(
          targetStore.id,
          {
            ...(body.id ? { id: String(body.id) } : {}),
            categoryId,
            sku: body.sku ? String(body.sku) : null,
            nameEn,
            namePtBr,
            descriptionEn: body.descriptionEn ? String(body.descriptionEn) : "",
            descriptionPtBr: body.descriptionPtBr ? String(body.descriptionPtBr) : "",
            priceCents: rawPriceCents,
            imagePath: body.imagePath ? String(body.imagePath) : null,
            isAvailable: body.isAvailable !== undefined ? Boolean(body.isAvailable) : true,
            isPaused: body.isPaused !== undefined ? Boolean(body.isPaused) : false,
            maxPerOrder: body.maxPerOrder !== undefined ? Number(body.maxPerOrder) : 20,
            unitOfMeasure: (body.unitOfMeasure as "UNIT" | "GRAM" | "KG") ?? "UNIT",
          },
          locale
        );

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: "CATALOG_PRODUCT_CREATED",
          targetType: "CATALOG_PRODUCT",
          targetId: createdProd.id,
          correlationId,
          reason: `Created product ${nameEn}`,
          redactedPayload: {
            storeId: targetStore.id,
            categoryId,
            priceCents: rawPriceCents,
          },
          createdAt: new Date().toISOString(),
        });

        sendJson(res, 201, correlationId, { data: createdProd });
        return;
      }

      const partnerProductItemMatch = pathname.match(
        /^\/v1\/partner\/stores\/([^/]+)\/products\/([^/]+)$/
      );
      if (partnerProductItemMatch && (method === "PATCH" || method === "DELETE")) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const storeId = partnerProductItemMatch[1] ?? "";
        const productId = partnerProductItemMatch[2] ?? "";
        const targetStore = await deps.repository.getStoreById(storeId, locale);
        if (!targetStore) {
          sendError(res, 404, "STORE_NOT_FOUND", `Store ${storeId} not found.`, correlationId);
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: targetStore.organizationId,
          storeId: targetStore.id,
          allowedRoles:
            method === "DELETE"
              ? ["partner_owner", "partner_manager", "partner_catalog"]
              : ["partner_owner", "partner_manager", "partner_catalog", "partner_operator"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to modify catalog products.", correlationId);
          return;
        }

        if (method === "DELETE") {
          const deleted = await deps.repository.deleteCatalogProduct(targetStore.id, productId);
          if (!deleted) {
            sendError(res, 404, "PRODUCT_NOT_FOUND", `Product ${productId} not found.`, correlationId);
            return;
          }
          sendJson(res, 200, correlationId, { deleted: true, id: productId });
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const patch: Partial<CatalogProductUpsertContract> = {};
        if (body.categoryId !== undefined) patch.categoryId = String(body.categoryId);
        if (body.sku !== undefined) patch.sku = body.sku ? String(body.sku) : null;
        if (body.nameEn !== undefined) patch.nameEn = String(body.nameEn).trim();
        if (body.namePtBr !== undefined) patch.namePtBr = String(body.namePtBr).trim();
        if (body.descriptionEn !== undefined) patch.descriptionEn = String(body.descriptionEn);
        if (body.descriptionPtBr !== undefined)
          patch.descriptionPtBr = String(body.descriptionPtBr);
        if (body.priceCents !== undefined) {
          const priceCents = Number(body.priceCents);
          if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
            sendError(res, 400, "INVALID_MONETARY_CENTS", "priceCents must be a non-negative integer.", correlationId);
            return;
          }
          patch.priceCents = priceCents;
        }
        if (body.imagePath !== undefined)
          patch.imagePath = body.imagePath ? String(body.imagePath) : null;
        if (body.isAvailable !== undefined) patch.isAvailable = Boolean(body.isAvailable);
        if (body.isPaused !== undefined) patch.isPaused = Boolean(body.isPaused);
        if (body.maxPerOrder !== undefined) patch.maxPerOrder = Number(body.maxPerOrder);
        if (body.unitOfMeasure !== undefined)
          patch.unitOfMeasure = body.unitOfMeasure as "UNIT" | "GRAM" | "KG";

        const updatedProd = await deps.repository.updateCatalogProduct(
          targetStore.id,
          productId,
          patch,
          locale
        );
        if (!updatedProd) {
          sendError(res, 404, "PRODUCT_NOT_FOUND", `Product ${productId} not found.`, correlationId);
          return;
        }
        sendJson(res, 200, correlationId, { data: updatedProd });
        return;
      }

      // 32. POST / PATCH / DELETE /v1/partner/products/:productId/option-groups (M04 / M07)
      const optionGroupsPostMatch = pathname.match(
        /^\/v1\/partner\/products\/([^/]+)\/option-groups$/
      );
      if (method === "POST" && optionGroupsPostMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const productId = optionGroupsPostMatch[1] ?? "";
        const storeId = await deps.repository.getProductStoreId(productId);
        if (!storeId) {
          sendError(res, 404, "PRODUCT_NOT_FOUND", `Product ${productId} not found.`, correlationId);
          return;
        }
        const targetStore = await deps.repository.getStoreById(storeId, locale);
        if (!targetStore) {
          sendError(res, 404, "STORE_NOT_FOUND", `Store ${storeId} not found.`, correlationId);
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: targetStore.organizationId,
          storeId: targetStore.id,
          allowedRoles: ["partner_owner", "partner_manager", "partner_catalog"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to manage option groups.", correlationId);
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const nameEn = String(body.nameEn ?? "").trim();
        const namePtBr = String(body.namePtBr ?? "").trim();
        const minSelections = Number(body.minSelections ?? 0);
        const maxSelections = Number(body.maxSelections ?? 1);

        if (
          !nameEn ||
          !namePtBr ||
          !Number.isInteger(minSelections) ||
          minSelections < 0 ||
          !Number.isInteger(maxSelections) ||
          maxSelections < 1 ||
          minSelections > maxSelections
        ) {
          sendError(
            res,
            400,
            "INVALID_OPTION_GROUP_BOUNDS",
            "nameEn, namePtBr, and valid bounds (0 <= minSelections <= maxSelections, maxSelections >= 1) are required.",
            correlationId
          );
          return;
        }

        const createdGroup = await deps.repository.createCatalogOptionGroup(
          productId,
          targetStore.id,
          {
            ...(body.id ? { id: String(body.id) } : {}),
            nameEn,
            namePtBr,
            minSelections,
            maxSelections,
            sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : 0,
          },
          locale
        );

        sendJson(res, 201, correlationId, { data: createdGroup });
        return;
      }

      const optionGroupItemMatch = pathname.match(
        /^\/v1\/partner\/products\/([^/]+)\/option-groups\/([^/]+)$/
      );
      if (optionGroupItemMatch && (method === "PATCH" || method === "DELETE")) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const productId = optionGroupItemMatch[1] ?? "";
        const groupId = optionGroupItemMatch[2] ?? "";
        const storeId = await deps.repository.getProductStoreId(productId);
        if (!storeId) {
          sendError(res, 404, "PRODUCT_NOT_FOUND", `Product ${productId} not found.`, correlationId);
          return;
        }
        const targetStore = await deps.repository.getStoreById(storeId, locale);
        if (!targetStore) {
          sendError(res, 404, "STORE_NOT_FOUND", `Store ${storeId} not found.`, correlationId);
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: targetStore.organizationId,
          storeId: targetStore.id,
          allowedRoles: ["partner_owner", "partner_manager", "partner_catalog"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to modify option groups.", correlationId);
          return;
        }

        if (method === "DELETE") {
          const deleted = await deps.repository.deleteCatalogOptionGroup(productId, groupId);
          if (!deleted) {
            sendError(res, 404, "OPTION_GROUP_NOT_FOUND", `Option group ${groupId} not found.`, correlationId);
            return;
          }
          sendJson(res, 200, correlationId, { deleted: true, id: groupId });
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        if (
          body.minSelections !== undefined &&
          body.maxSelections !== undefined &&
          Number(body.minSelections) > Number(body.maxSelections)
        ) {
          sendError(
            res,
            400,
            "INVALID_OPTION_GROUP_BOUNDS",
            "minSelections cannot exceed maxSelections.",
            correlationId
          );
          return;
        }

        const groupPatch: Partial<CatalogOptionGroupUpsertContract> = {};
        if (body.nameEn !== undefined) groupPatch.nameEn = String(body.nameEn).trim();
        if (body.namePtBr !== undefined) groupPatch.namePtBr = String(body.namePtBr).trim();
        if (body.minSelections !== undefined)
          groupPatch.minSelections = Number(body.minSelections);
        if (body.maxSelections !== undefined)
          groupPatch.maxSelections = Number(body.maxSelections);
        if (body.sortOrder !== undefined) groupPatch.sortOrder = Number(body.sortOrder);

        const updatedGroup = await deps.repository.updateCatalogOptionGroup(
          productId,
          groupId,
          groupPatch,
          locale
        );
        if (!updatedGroup) {
          sendError(res, 404, "OPTION_GROUP_NOT_FOUND", `Option group ${groupId} not found.`, correlationId);
          return;
        }
        sendJson(res, 200, correlationId, { data: updatedGroup });
        return;
      }

      // 33. POST / PATCH / DELETE Options under Option Groups (M04 / M07)
      const optionsPostMatch =
        pathname.match(
          /^\/v1\/partner\/products\/[^/]+\/option-groups\/([^/]+)\/options$/
        ) ?? pathname.match(/^\/v1\/partner\/option-groups\/([^/]+)\/options$/);
      if (method === "POST" && optionsPostMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const groupId = optionsPostMatch[1] ?? "";
        const ctx = await deps.repository.getOptionGroupContext(groupId);
        if (!ctx) {
          sendError(res, 404, "OPTION_GROUP_NOT_FOUND", `Option group ${groupId} not found.`, correlationId);
          return;
        }
        const targetStore = await deps.repository.getStoreById(ctx.storeId, locale);
        if (!targetStore) {
          sendError(res, 404, "STORE_NOT_FOUND", `Store ${ctx.storeId} not found.`, correlationId);
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: targetStore.organizationId,
          storeId: targetStore.id,
          allowedRoles: ["partner_owner", "partner_manager", "partner_catalog"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to create catalog options.", correlationId);
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const nameEn = String(body.nameEn ?? "").trim();
        const namePtBr = String(body.namePtBr ?? "").trim();
        const additionalPriceCents = Number(body.additionalPriceCents ?? 0);
        if (
          !nameEn ||
          !namePtBr ||
          !Number.isSafeInteger(additionalPriceCents) ||
          additionalPriceCents < 0
        ) {
          sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "nameEn, namePtBr, and non-negative integer additionalPriceCents are required.",
            correlationId
          );
          return;
        }

        const createdOpt = await deps.repository.createCatalogOption(
          groupId,
          targetStore.id,
          {
            ...(body.id ? { id: String(body.id) } : {}),
            nameEn,
            namePtBr,
            additionalPriceCents,
            isAvailable: body.isAvailable !== undefined ? Boolean(body.isAvailable) : true,
            sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : 0,
          },
          locale
        );

        sendJson(res, 201, correlationId, { data: createdOpt });
        return;
      }

      const optionItemMatch =
        pathname.match(/^\/v1\/partner\/products\/[^/]+\/options\/([^/]+)$/) ??
        pathname.match(/^\/v1\/partner\/options\/([^/]+)$/);
      if (optionItemMatch && (method === "PATCH" || method === "DELETE")) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const optionId = optionItemMatch[1] ?? "";
        const ctx = await deps.repository.getOptionContext(optionId);
        if (!ctx) {
          sendError(res, 404, "OPTION_NOT_FOUND", `Option ${optionId} not found.`, correlationId);
          return;
        }
        const targetStore = await deps.repository.getStoreById(ctx.storeId, locale);
        if (!targetStore) {
          sendError(res, 404, "STORE_NOT_FOUND", `Store ${ctx.storeId} not found.`, correlationId);
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: targetStore.organizationId,
          storeId: targetStore.id,
          allowedRoles: ["partner_owner", "partner_manager", "partner_catalog", "partner_operator"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to modify catalog options.", correlationId);
          return;
        }

        if (method === "DELETE") {
          const deleted = await deps.repository.deleteCatalogOption(optionId, targetStore.id);
          if (!deleted) {
            sendError(res, 404, "OPTION_NOT_FOUND", `Option ${optionId} not found.`, correlationId);
            return;
          }
          sendJson(res, 200, correlationId, { deleted: true, id: optionId });
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        if (
          body.additionalPriceCents !== undefined &&
          (!Number.isSafeInteger(Number(body.additionalPriceCents)) ||
            Number(body.additionalPriceCents) < 0)
        ) {
          sendError(
            res,
            400,
            "INVALID_MONETARY_CENTS",
            "additionalPriceCents must be a non-negative integer.",
            correlationId
          );
          return;
        }

        const optPatch: Partial<CatalogOptionUpsertContract> = {};
        if (body.nameEn !== undefined) optPatch.nameEn = String(body.nameEn).trim();
        if (body.namePtBr !== undefined) optPatch.namePtBr = String(body.namePtBr).trim();
        if (body.additionalPriceCents !== undefined)
          optPatch.additionalPriceCents = Number(body.additionalPriceCents);
        if (body.isAvailable !== undefined) optPatch.isAvailable = Boolean(body.isAvailable);
        if (body.sortOrder !== undefined) optPatch.sortOrder = Number(body.sortOrder);

        const updatedOpt = await deps.repository.updateCatalogOption(
          optionId,
          targetStore.id,
          optPatch,
          locale
        );
        if (!updatedOpt) {
          sendError(res, 404, "OPTION_NOT_FOUND", `Option ${optionId} not found.`, correlationId);
          return;
        }
        sendJson(res, 200, correlationId, { data: updatedOpt });
        return;
      }

      // 34. POST /v1/storage/signed-upload-url (M02 / M07 — Secure Server-Validated Upload URL Generation)
      if (method === "POST" && pathname === "/v1/storage/signed-upload-url") {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const bucket = String(body.bucket ?? "").trim() as AuthorizedStorageBucket;
        const rawFileName = String(body.fileName ?? "").trim();
        const mimeType = String(body.mimeType ?? "").trim().toLowerCase();
        const fileSizeBytes = Number(body.fileSizeBytes ?? 0);
        const requestedStoreId = body.storeId ? String(body.storeId).trim() : null;

        const bucketPolicies: Record<
          AuthorizedStorageBucket,
          {
            maxSizeBytes: number;
            allowedMimeTypes: string[];
            requiresStoreScope: boolean;
          }
        > = {
          "store-assets": {
            maxSizeBytes: 5_242_880,
            allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
            requiresStoreScope: true,
          },
          "catalog-media": {
            maxSizeBytes: 5_242_880,
            allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
            requiresStoreScope: true,
          },
          "public-store-assets": {
            maxSizeBytes: 5_242_880,
            allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
            requiresStoreScope: true,
          },
          "partner-kyc-docs": {
            maxSizeBytes: 10_485_760,
            allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
            requiresStoreScope: false,
          },
          "courier-kyc-docs": {
            maxSizeBytes: 10_485_760,
            allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
            requiresStoreScope: false,
          },
          "private-kyc-docs": {
            maxSizeBytes: 10_485_760,
            allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
            requiresStoreScope: false,
          },
          "support-attachments": {
            maxSizeBytes: 10_485_760,
            allowedMimeTypes: [
              "image/jpeg",
              "image/png",
              "image/webp",
              "application/pdf",
            ],
            requiresStoreScope: false,
          },
          "private-support-attachments": {
            maxSizeBytes: 10_485_760,
            allowedMimeTypes: [
              "image/jpeg",
              "image/png",
              "image/webp",
              "application/pdf",
            ],
            requiresStoreScope: false,
          },
          "private-pod-evidence": {
            maxSizeBytes: 10_485_760,
            allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
            requiresStoreScope: false,
          },
        };

        const policy = bucketPolicies[bucket];
        if (!policy) {
          sendError(
            res,
            400,
            "STORAGE_INVALID_BUCKET",
            `Bucket '${bucket}' is not an authorized storage bucket.`,
            correlationId
          );
          return;
        }

        if (
          !rawFileName ||
          rawFileName.includes("..") ||
          rawFileName.includes("/") ||
          rawFileName.includes("\\")
        ) {
          sendError(
            res,
            400,
            "STORAGE_INVALID_FILENAME",
            "fileName must be a clean basename without path traversal characters.",
            correlationId
          );
          return;
        }

        if (!policy.allowedMimeTypes.includes(mimeType)) {
          sendError(
            res,
            400,
            "STORAGE_INVALID_MIME_TYPE",
            `MIME type '${mimeType}' is not allowed in bucket '${bucket}'.`,
            correlationId
          );
          return;
        }

        if (
          !Number.isSafeInteger(fileSizeBytes) ||
          fileSizeBytes <= 0 ||
          fileSizeBytes > policy.maxSizeBytes
        ) {
          sendError(
            res,
            400,
            "STORAGE_FILE_TOO_LARGE",
            `fileSizeBytes must be between 1 and ${policy.maxSizeBytes} bytes for bucket '${bucket}'.`,
            correlationId
          );
          return;
        }

        let resolvedStoreId: string | null = null;
        let resolvedOrgId: string | null = null;
        let folderPrefix = actor.id;

        if (policy.requiresStoreScope || requestedStoreId) {
          if (!requestedStoreId) {
            sendError(
              res,
              400,
              "STORAGE_STORE_ID_REQUIRED",
              `storeId is required when uploading to bucket '${bucket}'.`,
              correlationId
            );
            return;
          }
          const targetStore = await deps.repository.getStoreById(
            requestedStoreId,
            locale
          );
          if (!targetStore) {
            sendError(
              res,
              404,
              "STORE_NOT_FOUND",
              `Store ${requestedStoreId} not found.`,
              correlationId
            );
            return;
          }
          const decision = authorizePartnerScope({
            actor,
            organizationId: targetStore.organizationId,
            storeId: targetStore.id,
            allowedRoles: ["partner_owner", "partner_manager", "partner_catalog"],
          });
          if (!decision.allowed) {
            sendError(
              res,
              403,
              decision.reasonCode,
              "Not authorized to upload assets for this store.",
              correlationId
            );
            return;
          }
          resolvedStoreId = targetStore.id;
          resolvedOrgId = targetStore.organizationId;
          folderPrefix = targetStore.id;
        }

        const sanitizedFileName = rawFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const uploadIntentId = crypto.randomUUID();
        const objectPath = `${folderPrefix}/${uploadIntentId}-${sanitizedFileName}`;
        const expiresAtIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        const signingSecret =
          env.SUPABASE_JWT_SECRET ?? "ideliveryfood_storage_signing_secret";
        const uploadToken = crypto
          .createHmac("sha256", signingSecret)
          .update(`${uploadIntentId}:${bucket}:${objectPath}:${expiresAtIso}`)
          .digest("hex");
        const signedTokenHash = crypto
          .createHash("sha256")
          .update(uploadToken)
          .digest("hex");

        await deps.repository.saveStorageUploadIntent({
          id: uploadIntentId,
          bucket,
          objectPath,
          mimeType,
          fileSizeBytes,
          uploadedBy: actor.id,
          storeId: resolvedStoreId,
          organizationId: resolvedOrgId,
          signedTokenHash,
          expiresAtIso,
        });

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: "STORAGE_SIGNED_UPLOAD_URL_ISSUED",
          targetType: "STORAGE_OBJECT",
          targetId: uploadIntentId,
          correlationId,
          reason: `Signed upload URL for ${bucket}/${objectPath}`,
          redactedPayload: {
            bucket,
            objectPath,
            mimeType,
            fileSizeBytes,
            storeId: resolvedStoreId,
          },
          createdAt: new Date().toISOString(),
        });

        const supabaseUrl = (
          env.SUPABASE_URL ??
          env.NEXT_PUBLIC_SUPABASE_URL ??
          "https://dwsoochnfxldfvcaijie.supabase.co"
        ).replace(/\/+$/, "");

        const responsePayload: SignedUploadUrlResponseContract = {
          uploadIntentId,
          bucket,
          objectPath,
          signedUploadUrl: `${supabaseUrl}/storage/v1/object/upload/sign/${bucket}/${objectPath}?token=${uploadToken}`,
          uploadToken,
          expiresAtIso,
          maxSizeBytes: policy.maxSizeBytes,
          allowedMimeTypes: policy.allowedMimeTypes,
        };

        sendJson(res, 201, correlationId, { data: responsePayload });
        return;
      }

      // 33. Fase H: GET /v1/partner/organizations/:orgId/finance-summary (M07 / M13 — Partner Owner & Partner Finance only)
      const partnerFinanceMatch = pathname.match(
        /^\/v1\/partner\/organizations\/([^/]+)\/finance-summary$/
      );
      if (method === "GET" && partnerFinanceMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const orgId = partnerFinanceMatch[1] ?? "";
        const decision = authorizePartnerScope({
          actor,
          organizationId: orgId,
          storeId: null,
          allowedRoles: ["partner_owner", "partner_finance"],
        });
        if (!decision.allowed) {
          sendError(
            res,
            403,
            decision.reasonCode,
            "Financial ledger and settlements are restricted to Partner Owner and Partner Finance roles.",
            correlationId
          );
          return;
        }
        const summary = deps.repository.getPartnerFinanceSummary
          ? await deps.repository.getPartnerFinanceSummary(orgId)
          : {
              organizationId: orgId,
              payableBalanceCents: 0,
              ordersCount: 0,
              grossMerchandiseCents: 0,
              platformCommissionCents: 0,
              merchantNetCents: 0,
              settlements: [],
            };
        sendJson(res, 200, correlationId, { data: summary });
        return;
      }

      // 34. Fase H: GET /v1/partner/organizations/:orgId/contract (M07 / M18)
      const partnerContractMatch = pathname.match(
        /^\/v1\/partner\/organizations\/([^/]+)\/contract$/
      );
      if (method === "GET" && partnerContractMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const orgId = partnerContractMatch[1] ?? "";
        const decision = authorizePartnerScope({
          actor,
          organizationId: orgId,
          storeId: null,
          allowedRoles: [
            "partner_owner",
            "partner_manager",
            "partner_finance",
          ],
        });
        if (!decision.allowed) {
          sendError(
            res,
            403,
            decision.reasonCode,
            "Not authorized to view merchant commercial contract.",
            correlationId
          );
          return;
        }
        const contract = deps.repository.getMerchantContract
          ? await deps.repository.getMerchantContract(orgId)
          : null;
        sendJson(res, 200, correlationId, { data: contract });
        return;
      }

      // 35. Fase H: GET /v1/partner/stores/:storeId/reviews & POST /v1/partner/stores/:storeId/reviews/:reviewId/reply (M07 / M19)
      const partnerStoreReviewsMatch = pathname.match(
        /^\/v1\/partner\/stores\/([^/]+)\/reviews(?:\s*|\/([^/]+)\/reply)?$/
      );
      if (partnerStoreReviewsMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const storeId = partnerStoreReviewsMatch[1] ?? "";
        const reviewId = partnerStoreReviewsMatch[2];
        const store = await deps.repository.getStoreById(storeId, locale);
        if (!store) {
          sendError(
            res,
            404,
            "STORE_NOT_FOUND",
            `Store ${storeId} not found.`,
            correlationId
          );
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: store.organizationId,
          storeId: store.id,
          allowedRoles: [
            "partner_owner",
            "partner_manager",
            "partner_operator",
            "partner_support",
          ],
        });
        if (!decision.allowed) {
          sendError(
            res,
            403,
            decision.reasonCode,
            "Not authorized to access store reviews.",
            correlationId
          );
          return;
        }
        if (method === "GET" && !reviewId) {
          const reviews = deps.repository.listStoreReviews
            ? await deps.repository.listStoreReviews(store.id)
            : [];
          sendJson(res, 200, correlationId, { data: reviews });
          return;
        }
        if (method === "POST" && reviewId) {
          const { json: body } = await readRawAndJsonBody(req);
          const replyText = String(body.reply ?? "").trim();
          if (!replyText) {
            sendError(
              res,
              400,
              "VALIDATION_ERROR",
              "reply text is required.",
              correlationId
            );
            return;
          }
          const updated = deps.repository.replyToStoreReview
            ? await deps.repository.replyToStoreReview(
                store.id,
                reviewId,
                replyText
              )
            : null;
          if (!updated) {
            sendError(
              res,
              404,
              "REVIEW_NOT_FOUND",
              `Review ${reviewId} not found.`,
              correlationId
            );
            return;
          }
          sendJson(res, 200, correlationId, { data: updated });
          return;
        }
      }

      // 36. Fase H: GET /v1/partner/stores/:storeId/support-cases (M07 / M17)
      const partnerSupportCasesMatch = pathname.match(
        /^\/v1\/partner\/stores\/([^/]+)\/support-cases$/
      );
      if (method === "GET" && partnerSupportCasesMatch) {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const storeId = partnerSupportCasesMatch[1] ?? "";
        const store = await deps.repository.getStoreById(storeId, locale);
        if (!store) {
          sendError(
            res,
            404,
            "STORE_NOT_FOUND",
            `Store ${storeId} not found.`,
            correlationId
          );
          return;
        }
        const decision = authorizePartnerScope({
          actor,
          organizationId: store.organizationId,
          storeId: store.id,
          allowedRoles: [
            "partner_owner",
            "partner_manager",
            "partner_operator",
            "partner_support",
          ],
        });
        if (!decision.allowed) {
          sendError(
            res,
            403,
            decision.reasonCode,
            "Not authorized to view store support cases.",
            correlationId
          );
          return;
        }
        const cases = deps.repository.listStoreSupportCases
          ? await deps.repository.listStoreSupportCases(store.id)
          : [];
        sendJson(res, 200, correlationId, { data: cases });
        return;
      }

      // 37. Fase I: GET /v1/admin/overview (M16 — Central Admin Backoffice overview requiring staff role + MFA aal2)
      if (method === "GET" && pathname === "/v1/admin/overview") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const staffDecision = authorizeStaffAction({
          actor,
          allowedRoles: [
            "operations",
            "finance",
            "risk_compliance",
            "commercial",
            "growth_marketing",
            "support_l1",
            "support_l2",
            "tech_admin",
          ],
          requireMfaAal2: true,
        });
        if (!staffDecision.allowed) {
          sendError(
            res,
            403,
            staffDecision.reasonCode,
            "Central Admin Backoffice requires an authorized staff role with MFA aal2.",
            correlationId
          );
          return;
        }
        const overview = deps.repository.getAdminOverview
          ? await deps.repository.getAdminOverview()
          : {
              organizations: [],
              stores: [],
              couriers: [],
              approvalEvents: [],
              staffScopes: [],
              auditLogs: await deps.repository.getAuditLogs(),
            };
        sendJson(res, 200, correlationId, { data: overview });
        return;
      }

      // 38. Fase I: GET /v1/finance/overview (M13 — Financial Backoffice overview requiring finance/tech_admin + MFA aal2)
      if (method === "GET" && pathname === "/v1/finance/overview") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const staffDecision = authorizeStaffAction({
          actor,
          allowedRoles: ["finance", "tech_admin"],
          requireMfaAal2: true,
        });
        if (!staffDecision.allowed) {
          sendError(
            res,
            403,
            staffDecision.reasonCode,
            "Financial Backoffice requires finance or tech_admin role with MFA aal2.",
            correlationId
          );
          return;
        }
        const finOverview = deps.repository.getFinanceBackofficeOverview
          ? await deps.repository.getFinanceBackofficeOverview()
          : {
              gmvCents: 0,
              netPlatformRevenueCents: 0,
              merchantPayablesCents: 0,
              courierPayablesCents: 0,
              totalDebitsCents: 0,
              totalCreditsCents: 0,
              isLedgerBalanced: true,
              ledgerAccounts: [],
              orders: [],
              settlements: [],
              reconciliationRuns: [],
              refunds: [],
            };
        sendJson(res, 200, correlationId, { data: finOverview });
        return;
      }

      // 39. Fase I: GET /v1/logistics/overview (M14 — Logistics & Dispatch Console requiring operations/tech_admin + MFA aal2)
      if (method === "GET" && pathname === "/v1/logistics/overview") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const staffDecision = authorizeStaffAction({
          actor,
          allowedRoles: ["operations", "tech_admin"],
          requireMfaAal2: true,
        });
        if (!staffDecision.allowed) {
          sendError(
            res,
            403,
            staffDecision.reasonCode,
            "Logistics & Dispatch Console requires operations or tech_admin role with MFA aal2.",
            correlationId
          );
          return;
        }
        const logOverview = deps.repository.getLogisticsBackofficeOverview
          ? await deps.repository.getLogisticsBackofficeOverview()
          : {
              tasks: [],
              offers: [],
              locationSamples: [],
              onlineCouriers: [],
            };
        sendJson(res, 200, correlationId, { data: logOverview });
        return;
      }

      // 40. Fase I: GET /v1/fleets/overview (M15 — Fleet Operator Portal reading feature_fleet_operators_enabled from platform_policies)
      if (method === "GET" && pathname === "/v1/fleets/overview") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const fleetsOverview = deps.repository.getFleetsBackofficeOverview
          ? await deps.repository.getFleetsBackofficeOverview()
          : {
              policyKey: "DEFAULT_BR_MARKETPLACE",
              featureFleetOperatorsEnabled: false,
              couriers: [],
            };
        sendJson(res, 200, correlationId, { data: fleetsOverview });
        return;
      }

      // 41. Fase N: GET /v1/support/overview (M17 — Support Backoffice Console requiring support/operations/finance/risk_compliance/tech_admin)
      if (method === "GET" && pathname === "/v1/support/overview") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }
        const staffDecision = authorizeStaffAction({
          actor,
          allowedRoles: [
            "support",
            "support_l1",
            "support_l2",
            "operations",
            "finance",
            "risk_compliance",
            "tech_admin",
          ],
          requireMfaAal2: false,
        });
        if (!staffDecision.allowed) {
          sendError(
            res,
            403,
            staffDecision.reasonCode,
            "Support Backoffice Console requires an authorized support, operations, finance, or tech_admin staff role.",
            correlationId
          );
          return;
        }
        const overview = deps.repository.getSupportBackofficeOverview
          ? await deps.repository.getSupportBackofficeOverview()
          : {
              autoRefundLimitCents: 1500,
              cases: [],
              messages: [],
              attachments: [],
              actionRequests: [],
            };
        sendJson(res, 200, correlationId, { data: overview });
        return;
      }

      // 42. Fase N: GET /v1/support/cases & POST /v1/support/cases (M17 — Scoped case list & SLA-calculated case creation)
      if (pathname === "/v1/support/cases") {
        if (!actor) {
          sendError(
            res,
            401,
            "AUTH_UNAUTHORIZED",
            "Authentication required.",
            correlationId
          );
          return;
        }

        const isStaffActor = actor.staffScopes.some((s) =>
          [
            "support",
            "support_l1",
            "support_l2",
            "operations",
            "finance",
            "risk_compliance",
            "tech_admin",
          ].includes(s.role)
        );

        if (method === "GET") {
          const statusFilter = parsedUrl.searchParams.get("status") ?? undefined;
          const storeIds = actor.organizationMemberships
            .map((m) => m.storeId)
            .filter((id): id is string => typeof id === "string" && id.length > 0);

          const cases = deps.repository.listSupportCasesForActor
            ? await deps.repository.listSupportCasesForActor({
                actorId: actor.id,
                isStaffActor,
                storeIds,
                ...(statusFilter ? { statusFilter } : {}),
              })
            : [];
          sendJson(res, 200, correlationId, { data: cases });
          return;
        }

        if (method === "POST") {
          const { json: body } = await readRawAndJsonBody(req);
          const subject = String(body.subject ?? "").trim();
          if (subject.length < 3) {
            sendError(
              res,
              400,
              "VALIDATION_ERROR",
              "Support case subject of at least 3 characters is required.",
              correlationId
            );
            return;
          }

          const category = String(body.category ?? "ORDER_ISSUE").trim().toUpperCase();
          const rawPriority = String(body.priority ?? "MEDIUM").trim().toUpperCase();
          const requestedPriority = (
            ["LOW", "MEDIUM", "HIGH", "CRITICAL_IN_ROUTE"].includes(rawPriority)
              ? rawPriority
              : rawPriority === "CRITICAL"
                ? "CRITICAL_IN_ROUTE"
                : "MEDIUM"
          ) as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL_IN_ROUTE";

          const sla = computeSupportSlaDueAt({
            priority: requestedPriority,
            category,
          });

          const rawRequesterRole = String(body.requesterRole ?? "").toUpperCase();
          const requesterRole: "CUSTOMER" | "PARTNER" | "COURIER" =
            rawRequesterRole === "PARTNER" || rawRequesterRole === "COURIER"
              ? rawRequesterRole
              : actor.organizationMemberships.length > 0
                ? "PARTNER"
                : "CUSTOMER";

          const orderId = body.orderId ? String(body.orderId) : null;
          const deliveryTaskId = body.deliveryTaskId ? String(body.deliveryTaskId) : null;
          let organizationId = body.organizationId ? String(body.organizationId) : null;
          let storeId = body.storeId ? String(body.storeId) : null;

          if (orderId && (!organizationId || !storeId)) {
            const linkedOrder = await deps.repository.getOrderById(orderId);
            if (linkedOrder) {
              organizationId = organizationId ?? linkedOrder.organizationId;
              storeId = storeId ?? linkedOrder.storeId;
            }
          }

          if (!deps.repository.createSupportCase) {
            sendError(res, 501, "NOT_IMPLEMENTED", "Support repository not configured.", correlationId);
            return;
          }

          const nowIso = new Date().toISOString();
          const createdCase = await deps.repository.createSupportCase({
            id: crypto.randomUUID(),
            orderId,
            deliveryTaskId,
            organizationId,
            storeId,
            requesterId: actor.id,
            requesterRole,
            assignedStaffId: null,
            category,
            priority: sla.effectivePriority,
            status: "OPEN",
            subject,
            slaDueAtIso: sla.slaDueAtIso,
            resolvedAtIso: null,
            createdAtIso: nowIso,
            updatedAtIso: nowIso,
          });

          if (body.initialMessage && String(body.initialMessage).trim().length > 0 && deps.repository.createSupportMessage) {
            await deps.repository.createSupportMessage({
              message: {
                id: crypto.randomUUID(),
                caseId: createdCase.id,
                senderId: actor.id,
                body: String(body.initialMessage).trim(),
                isInternalNote: false,
                createdAtIso: nowIso,
              },
            });
          }

          sendJson(res, 201, correlationId, { data: createdCase });
          return;
        }
      }

      // 43. Fase N: GET /v1/support/cases/:caseId (M17 — Strict actor visibility & internal note stripping)
      const supportCaseDetailMatch = pathname.match(/^\/v1\/support\/cases\/([^/]+)$/);
      if (method === "GET" && supportCaseDetailMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const caseId = supportCaseDetailMatch[1] ?? "";
        if (!deps.repository.getSupportCaseDetail) {
          sendError(res, 501, "NOT_IMPLEMENTED", "Support repository not configured.", correlationId);
          return;
        }

        const detail = await deps.repository.getSupportCaseDetail(caseId);
        if (!detail) {
          sendError(res, 404, "SUPPORT_CASE_NOT_FOUND", `Support case ${caseId} not found.`, correlationId);
          return;
        }

        const isStaffActor = actor.staffScopes.some((s) =>
          [
            "support",
            "support_l1",
            "support_l2",
            "operations",
            "finance",
            "risk_compliance",
            "tech_admin",
          ].includes(s.role)
        );
        const isRequester = detail.supportCase.requesterId === actor.id;
        const isStoreMember = actor.organizationMemberships.some(
          (m) =>
            (detail.supportCase.storeId !== null && m.storeId === detail.supportCase.storeId) ||
            (m.storeId === null &&
              detail.supportCase.organizationId !== null &&
              m.organizationId === detail.supportCase.organizationId)
        );

        if (!isStaffActor && !isRequester && !isStoreMember) {
          sendError(
            res,
            403,
            "SUPPORT_CASE_ACCESS_DENIED",
            "You do not have permission to view this support case.",
            correlationId
          );
          return;
        }

        const filtered = filterSupportCaseViewForActor({
          supportCase: {
            ...detail.supportCase,
            deliveryTaskId: detail.supportCase.deliveryTaskId ?? null,
            assignedStaffId: detail.supportCase.assignedStaffId ?? null,
            resolvedAtIso: detail.supportCase.resolvedAtIso ?? null,
            updatedAtIso: detail.supportCase.updatedAtIso ?? detail.supportCase.createdAtIso,
            priority:
              detail.supportCase.priority === "CRITICAL"
                ? "CRITICAL_IN_ROUTE"
                : detail.supportCase.priority,
            status:
              detail.supportCase.status === "WAITING_USER"
                ? "WAITING_CUSTOMER"
                : detail.supportCase.status,
          },
          messages: detail.messages,
          attachments: detail.attachments,
          actionRequests: detail.actionRequests.map((ar) => ({
            ...ar,
            decidedAtIso: ar.decidedAtIso ?? null,
            decisionNotes: ar.decisionNotes ?? null,
          })),
          isStaffActor,
        });

        sendJson(res, 200, correlationId, { data: filtered });
        return;
      }

      // 44. Fase N: POST /v1/support/cases/:caseId/messages (M17 — Messages, internal notes & attachments)
      const supportMessageMatch = pathname.match(/^\/v1\/support\/cases\/([^/]+)\/messages$/);
      if (method === "POST" && supportMessageMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const caseId = supportMessageMatch[1] ?? "";
        if (!deps.repository.getSupportCaseDetail || !deps.repository.createSupportMessage) {
          sendError(res, 501, "NOT_IMPLEMENTED", "Support repository not configured.", correlationId);
          return;
        }

        const detail = await deps.repository.getSupportCaseDetail(caseId);
        if (!detail) {
          sendError(res, 404, "SUPPORT_CASE_NOT_FOUND", `Support case ${caseId} not found.`, correlationId);
          return;
        }

        const isStaffActor = actor.staffScopes.some((s) =>
          [
            "support",
            "support_l1",
            "support_l2",
            "operations",
            "finance",
            "risk_compliance",
            "tech_admin",
          ].includes(s.role)
        );
        const isRequester = detail.supportCase.requesterId === actor.id;
        const isStoreMember = actor.organizationMemberships.some(
          (m) =>
            (detail.supportCase.storeId !== null && m.storeId === detail.supportCase.storeId) ||
            (m.storeId === null &&
              detail.supportCase.organizationId !== null &&
              m.organizationId === detail.supportCase.organizationId)
        );

        if (!isStaffActor && !isRequester && !isStoreMember) {
          sendError(res, 403, "SUPPORT_CASE_ACCESS_DENIED", "Access denied.", correlationId);
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const messageBody = String(body.body ?? "").trim();
        if (messageBody.length === 0) {
          sendError(res, 400, "VALIDATION_ERROR", "Message body cannot be empty.", correlationId);
          return;
        }

        const isInternalNote = Boolean(body.isInternalNote ?? false);
        if (isInternalNote && !isStaffActor) {
          sendError(
            res,
            403,
            "FORBIDDEN_INTERNAL_NOTE",
            "Only internal platform staff can author internal support notes.",
            correlationId
          );
          return;
        }

        const nowIso = new Date().toISOString();
        const messageId = crypto.randomUUID();
        const rawAttachments = Array.isArray(body.attachments)
          ? (body.attachments as Array<Record<string, unknown>>)
          : [];

        const attachments: SupportAttachmentContract[] = rawAttachments.map((att) => ({
          id: crypto.randomUUID(),
          caseId: detail.supportCase.id,
          messageId,
          uploadedBy: actor.id,
          storageBucket: "support-attachments",
          objectPath: String(att.objectPath ?? `cases/${detail.supportCase.id}/${crypto.randomUUID()}.bin`),
          mimeType: String(att.mimeType ?? "application/octet-stream"),
          byteSize: Math.max(1, Number(att.byteSize ?? 1024)),
          sha256Hex: String(
            att.sha256Hex ??
              crypto.createHash("sha256").update(messageBody).digest("hex")
          ),
          isInternalOnly: isStaffActor ? Boolean(att.isInternalOnly ?? isInternalNote) : false,
          createdAtIso: nowIso,
        }));

        const saved = await deps.repository.createSupportMessage({
          message: {
            id: messageId,
            caseId: detail.supportCase.id,
            senderId: actor.id,
            body: messageBody,
            isInternalNote,
            createdAtIso: nowIso,
          },
          attachments,
        });

        sendJson(res, 201, correlationId, { data: saved });
        return;
      }

      // 45. Fase N: POST /v1/support/cases/:caseId/status (M17 — Support Case State Machine Transitions)
      const supportStatusMatch = pathname.match(/^\/v1\/support\/cases\/([^/]+)\/status$/);
      if (method === "POST" && supportStatusMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const staffDecision = authorizeStaffAction({
          actor,
          allowedRoles: [
            "support",
            "support_l1",
            "support_l2",
            "operations",
            "finance",
            "risk_compliance",
            "tech_admin",
          ],
          requireMfaAal2: false,
        });
        if (!staffDecision.allowed) {
          sendError(
            res,
            403,
            staffDecision.reasonCode,
            "Only authorized support or operations staff can transition support case status.",
            correlationId
          );
          return;
        }

        const caseId = supportStatusMatch[1] ?? "";
        if (!deps.repository.getSupportCaseDetail || !deps.repository.updateSupportCaseStatus) {
          sendError(res, 501, "NOT_IMPLEMENTED", "Support repository not configured.", correlationId);
          return;
        }

        const detail = await deps.repository.getSupportCaseDetail(caseId);
        if (!detail) {
          sendError(res, 404, "SUPPORT_CASE_NOT_FOUND", `Support case ${caseId} not found.`, correlationId);
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const targetStatus = String(body.status ?? "") as Exclude<SupportCaseStatus, "WAITING_USER">;

        try {
          const transitioned = transitionSupportCaseStatus({
            supportCase: {
              ...detail.supportCase,
              deliveryTaskId: detail.supportCase.deliveryTaskId ?? null,
              assignedStaffId: detail.supportCase.assignedStaffId ?? null,
              resolvedAtIso: detail.supportCase.resolvedAtIso ?? null,
              updatedAtIso: detail.supportCase.updatedAtIso ?? detail.supportCase.createdAtIso,
              priority:
                detail.supportCase.priority === "CRITICAL"
                  ? "CRITICAL_IN_ROUTE"
                  : detail.supportCase.priority,
              status:
                detail.supportCase.status === "WAITING_USER"
                  ? "WAITING_CUSTOMER"
                  : detail.supportCase.status,
            },
            targetStatus,
            assignedStaffId:
              body.assignedStaffId !== undefined
                ? body.assignedStaffId
                  ? String(body.assignedStaffId)
                  : null
                : actor.id,
          });

          const updated = await deps.repository.updateSupportCaseStatus({
            caseId: detail.supportCase.id,
            status: transitioned.status,
            assignedStaffId: transitioned.assignedStaffId,
            resolvedAtIso: transitioned.resolvedAtIso,
          });

          await deps.repository.appendAuditLog({
            id: crypto.randomUUID(),
            actorId: actor.id,
            action: "SUPPORT_CASE_STATUS_TRANSITIONED",
            targetType: "SUPPORT_CASE",
            targetId: detail.supportCase.id,
            correlationId,
            reason: body.reason ? String(body.reason) : `Transitioned to ${transitioned.status}`,
            redactedPayload: {
              previousStatus: detail.supportCase.status,
              newStatus: transitioned.status,
              assignedStaffId: transitioned.assignedStaffId,
            },
            createdAt: new Date().toISOString(),
          });

          sendJson(res, 200, correlationId, { data: updated ?? transitioned });
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Invalid support case transition";
          sendError(res, 409, msg.split(":")[0] ?? "SUPPORT_CASE_INVALID_TRANSITION", msg, correlationId);
          return;
        }
      }

      // 46. Fase N: POST /v1/support/cases/:caseId/action-requests (M17 — Support Refund/Compensation with Auto-Approval Threshold)
      const supportActionReqMatch = pathname.match(
        /^\/v1\/support\/cases\/([^/]+)\/action-requests$/
      );
      if (method === "POST" && supportActionReqMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const staffDecision = authorizeStaffAction({
          actor,
          allowedRoles: ["support", "support_l1", "support_l2", "operations", "finance", "tech_admin"],
          requireMfaAal2: false,
        });
        if (!staffDecision.allowed) {
          sendError(
            res,
            403,
            staffDecision.reasonCode,
            "Only authorized support, operations, finance, or tech_admin staff can request support refunds.",
            correlationId
          );
          return;
        }

        const caseId = supportActionReqMatch[1] ?? "";
        if (
          !deps.repository.getSupportCaseDetail ||
          !deps.repository.createSupportActionRequest ||
          !deps.repository.updateSupportCaseStatus
        ) {
          sendError(res, 501, "NOT_IMPLEMENTED", "Support repository not configured.", correlationId);
          return;
        }

        const detail = await deps.repository.getSupportCaseDetail(caseId);
        if (!detail) {
          sendError(res, 404, "SUPPORT_CASE_NOT_FOUND", `Support case ${caseId} not found.`, correlationId);
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const orderId = body.orderId
          ? String(body.orderId)
          : (detail.supportCase.orderId ?? "");
        if (!orderId) {
          sendError(
            res,
            400,
            "SUPPORT_ORDER_REQUIRED",
            "An orderId is required to request a refund or compensation.",
            correlationId
          );
          return;
        }

        const order = await deps.repository.getOrderById(orderId);
        if (!order) {
          sendError(res, 404, "ORDER_NOT_FOUND", `Order ${orderId} not found.`, correlationId);
          return;
        }

        const existingRefunds = await deps.repository.listRefundsByOrder(order.id);
        const alreadyRefundedCents = existingRefunds.reduce(
          (sum, r) => sum + r.amountCents,
          0
        );
        const autoApproveLimitCents = deps.repository.getSupportAutoRefundLimitCents
          ? await deps.repository.getSupportAutoRefundLimitCents()
          : 1500;

        try {
          const rawActionType = String(body.actionType ?? "PARTIAL_REFUND").toUpperCase();
          const actionType: SupportActionType =
            rawActionType === "FULL_REFUND" || rawActionType === "COURIER_COMPENSATION"
              ? rawActionType
              : "PARTIAL_REFUND";

          const evaluation = evaluateSupportActionRequest({
            id: crypto.randomUUID(),
            caseId: detail.supportCase.id,
            orderId: order.id,
            requestedByStaffId: actor.id,
            actionType,
            amountCents: Number(body.amountCents ?? 0),
            orderCapturedCents: order.totalCents,
            alreadyRefundedCents,
            autoApproveLimitCents,
            reason: String(body.reason ?? ""),
          });

          const savedRequest = await deps.repository.createSupportActionRequest(
            evaluation.actionRequest
          );
          const updatedCase = await deps.repository.updateSupportCaseStatus({
            caseId: detail.supportCase.id,
            status: evaluation.nextCaseStatus,
            assignedStaffId: actor.id,
            resolvedAtIso:
              evaluation.nextCaseStatus === "RESOLVED"
                ? evaluation.actionRequest.createdAtIso
                : null,
          });

          let createdRefund: RefundRecordContract | null = null;
          if (
            evaluation.autoApproved &&
            (actionType === "PARTIAL_REFUND" || actionType === "FULL_REFUND")
          ) {
            const totalAfter = alreadyRefundedCents + evaluation.actionRequest.amountCents;
            const nextPaymentStatus =
              totalAfter >= order.totalCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
            const refundToSave: RefundRecordContract = {
              id: crypto.randomUUID(),
              orderId: order.id,
              paymentAttemptId: `pay_attempt_${order.id}`,
              requestedBy: actor.id,
              approvedBy: actor.id,
              amountCents: evaluation.actionRequest.amountCents,
              reason: evaluation.actionRequest.reason,
              status: "PROCESSED",
              idempotencyKey: `support_auto_refund_${savedRequest.id}`,
              createdAtIso: savedRequest.createdAtIso,
            };
            await deps.repository.saveRefundAndUpdateOrder(refundToSave, {
              ...order,
              paymentStatus: nextPaymentStatus,
              orderStatus:
                nextPaymentStatus === "REFUNDED" ? "REFUNDED" : order.orderStatus,
              version: order.version + 1,
              updatedAtIso: savedRequest.createdAtIso,
            });
            createdRefund = refundToSave;
          }

          await deps.repository.appendAuditLog({
            id: crypto.randomUUID(),
            actorId: actor.id,
            action: evaluation.autoApproved
              ? "SUPPORT_ACTION_AUTO_APPROVED"
              : "SUPPORT_ACTION_ESCALATED_FINANCE",
            targetType: "SUPPORT_ACTION_REQUEST",
            targetId: savedRequest.id,
            correlationId,
            reason: savedRequest.reason,
            redactedPayload: {
              caseId: detail.supportCase.id,
              orderId: order.id,
              actionType: savedRequest.actionType,
              amountCents: savedRequest.amountCents,
              autoApproveLimitCents,
              status: savedRequest.status,
            },
            createdAt: savedRequest.createdAtIso,
          });

          sendJson(res, 201, correlationId, {
            data: {
              actionRequest: savedRequest,
              autoApproved: evaluation.autoApproved,
              autoApproveLimitCents,
              supportCase: updatedCase,
              refund: createdRefund,
            },
          });
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Invalid support action request";
          sendError(res, 400, msg.split(":")[0] ?? "SUPPORT_ACTION_ERROR", msg, correlationId);
          return;
        }
      }

      // 47. Fase N: POST /v1/support/action-requests/:requestId/decide (M17/M13 — Finance MFA aal2 + Segregation of Duties)
      const supportActionDecideMatch = pathname.match(
        /^\/v1\/support\/action-requests\/([^/]+)\/decide$/
      );
      if (method === "POST" && supportActionDecideMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const requestId = supportActionDecideMatch[1] ?? "";
        if (
          !deps.repository.getSupportActionRequestById ||
          !deps.repository.updateSupportActionRequestDecision ||
          !deps.repository.updateSupportCaseStatus
        ) {
          sendError(res, 501, "NOT_IMPLEMENTED", "Support repository not configured.", correlationId);
          return;
        }

        const existingReq = await deps.repository.getSupportActionRequestById(requestId);
        if (!existingReq) {
          sendError(
            res,
            404,
            "SUPPORT_ACTION_REQUEST_NOT_FOUND",
            `Support action request ${requestId} not found.`,
            correlationId
          );
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const rawDecision = String(body.decision ?? "").toUpperCase();
        const decision: "APPROVED" | "REJECTED" =
          rawDecision === "REJECTED" ? "REJECTED" : "APPROVED";

        try {
          const decided = decideEscalatedSupportActionRequest({
            request: {
              ...existingReq,
              decidedAtIso: existingReq.decidedAtIso ?? null,
              decisionNotes: existingReq.decisionNotes ?? null,
            },
            decision,
            decidedByStaffId: actor.id,
            actorStaffRoles: actor.staffScopes.map((s) => s.role),
            actorAal: actor.aal,
            decisionNotes: String(body.decisionNotes ?? ""),
          });

          const savedDecision =
            await deps.repository.updateSupportActionRequestDecision(decided);

          let createdRefund: RefundRecordContract | null = null;
          if (
            savedDecision.status === "APPROVED" &&
            (savedDecision.actionType === "PARTIAL_REFUND" ||
              savedDecision.actionType === "FULL_REFUND")
          ) {
            const order = await deps.repository.getOrderById(savedDecision.orderId);
            if (order) {
              const existingRefunds = await deps.repository.listRefundsByOrder(order.id);
              const alreadyRefundedCents = existingRefunds.reduce(
                (sum, r) => sum + r.amountCents,
                0
              );
              const totalAfter = alreadyRefundedCents + savedDecision.amountCents;
              const nextPaymentStatus =
                totalAfter >= order.totalCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
              const refundToSave: RefundRecordContract = {
                id: crypto.randomUUID(),
                orderId: order.id,
                paymentAttemptId: `pay_attempt_${order.id}`,
                requestedBy: savedDecision.requestedBy,
                approvedBy: actor.id,
                amountCents: savedDecision.amountCents,
                reason: savedDecision.reason,
                status: "PROCESSED",
                idempotencyKey: `support_finance_refund_${savedDecision.id}`,
                createdAtIso: savedDecision.decidedAtIso ?? new Date().toISOString(),
              };
              await deps.repository.saveRefundAndUpdateOrder(refundToSave, {
                ...order,
                paymentStatus: nextPaymentStatus,
                orderStatus:
                  nextPaymentStatus === "REFUNDED" ? "REFUNDED" : order.orderStatus,
                version: order.version + 1,
                updatedAtIso: refundToSave.createdAtIso,
              });
              createdRefund = refundToSave;
            }
          }

          const nextCaseStatus: SupportCaseStatus =
            savedDecision.status === "APPROVED" ? "RESOLVED" : "IN_PROGRESS";
          const updatedCase = await deps.repository.updateSupportCaseStatus({
            caseId: savedDecision.caseId,
            status: nextCaseStatus,
            resolvedAtIso:
              nextCaseStatus === "RESOLVED"
                ? (savedDecision.decidedAtIso ?? new Date().toISOString())
                : null,
          });

          await deps.repository.appendAuditLog({
            id: crypto.randomUUID(),
            actorId: actor.id,
            action: `SUPPORT_ACTION_FINANCE_${savedDecision.status}`,
            targetType: "SUPPORT_ACTION_REQUEST",
            targetId: savedDecision.id,
            correlationId,
            reason: savedDecision.decisionNotes ?? savedDecision.reason,
            redactedPayload: {
              caseId: savedDecision.caseId,
              orderId: savedDecision.orderId,
              amountCents: savedDecision.amountCents,
              requestedBy: savedDecision.requestedBy,
              decidedBy: savedDecision.decidedBy,
              status: savedDecision.status,
            },
            createdAt: savedDecision.decidedAtIso ?? new Date().toISOString(),
          });

          sendJson(res, 200, correlationId, {
            data: {
              actionRequest: savedDecision,
              supportCase: updatedCase,
              refund: createdRefund,
            },
          });
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unable to decide support action request";
          const code = msg.split(":")[0] ?? "SUPPORT_DECISION_ERROR";
          const statusCode =
            code.includes("MFA") || code.includes("ROLE") || code.includes("SEGREGATION")
              ? 403
              : 400;
          sendError(res, statusCode, code, msg, correlationId);
          return;
        }
      }

      // =======================================================================
      // 20. Fase O (M18): Commercial Leads, Proposals, Contracts & Onboarding
      // =======================================================================

      // 20a. GET /v1/commercial/overview
      if (method === "GET" && pathname === "/v1/commercial/overview") {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const authz = authorizeStaffAction({
          actor,
          allowedRoles: ["commercial", "operations", "tech_admin"],
          requireMfaAal2: false,
        });
        if (!authz.allowed) {
          sendError(res, 403, authz.reasonCode, "Staff commercial/operations role required.", correlationId);
          return;
        }
        if (!deps.repository.getCommercialBackofficeOverview) {
          sendError(res, 501, "NOT_IMPLEMENTED", "Commercial repository not configured.", correlationId);
          return;
        }
        const overview = await deps.repository.getCommercialBackofficeOverview();
        sendJson(res, 200, correlationId, { data: overview });
        return;
      }

      // 20b. GET /v1/commercial/leads & POST /v1/commercial/leads
      if (pathname === "/v1/commercial/leads" && (method === "GET" || method === "POST")) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const authz = authorizeStaffAction({
          actor,
          allowedRoles: ["commercial", "operations", "tech_admin"],
          requireMfaAal2: false,
        });
        if (!authz.allowed) {
          sendError(res, 403, authz.reasonCode, "Staff commercial/operations role required.", correlationId);
          return;
        }
        if (!deps.repository.listCommercialLeads || !deps.repository.createCommercialLead) {
          sendError(res, 501, "NOT_IMPLEMENTED", "Commercial repository not configured.", correlationId);
          return;
        }

        if (method === "GET") {
          const statusFilter = parsedUrl.searchParams.get("status") ?? undefined;
          const leads = await deps.repository.listCommercialLeads(statusFilter);
          sendJson(res, 200, correlationId, { data: leads });
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const legalName = String(body.legalName ?? "").trim();
        const tradeName = String(body.tradeName ?? "").trim();
        const taxId = String(body.taxId ?? "").replace(/\D+/g, "");
        const contactEmail = String(body.contactEmail ?? "").trim();
        const contactPhone = String(body.contactPhone ?? "").trim();

        if (!legalName || !tradeName || taxId.length < 11 || !contactEmail) {
          sendError(
            res,
            400,
            "COMMERCIAL_LEAD_INVALID_FIELDS",
            "legalName, tradeName, taxId (>= 11 digits), and contactEmail are required.",
            correlationId
          );
          return;
        }

        const nowIso = new Date().toISOString();
        const createdLead = await deps.repository.createCommercialLead({
          id: body.id ? String(body.id) : crypto.randomUUID(),
          legalName,
          tradeName,
          taxId,
          contactEmail,
          contactPhone: contactPhone || "+5511900000000",
          city: String(body.city ?? "São Paulo"),
          stateCode: String(body.stateCode ?? "SP"),
          cuisineCategory: String(body.cuisineCategory ?? "RESTAURANT"),
          legalBasis: String(body.legalBasis ?? "PARTNER_INBOUND_APPLICATION"),
          status: "NEW",
          ownerStaffId: actor.id,
          convertedOrganizationId: null,
          notes: body.notes ? String(body.notes) : null,
          createdAtIso: nowIso,
          updatedAtIso: nowIso,
        });

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: "COMMERCIAL_LEAD_CREATED",
          targetType: "COMMERCIAL_LEAD",
          targetId: createdLead.id,
          correlationId,
          reason: `Created commercial lead for ${createdLead.tradeName}`,
          redactedPayload: {
            tradeName: createdLead.tradeName,
            city: createdLead.city,
            stateCode: createdLead.stateCode,
            status: createdLead.status,
          },
          createdAt: nowIso,
        });

        sendJson(res, 201, correlationId, { data: createdLead });
        return;
      }

      // 20c. POST /v1/commercial/leads/:leadId/status
      const leadStatusMatch = pathname.match(/^\/v1\/commercial\/leads\/([^/]+)\/status$/);
      if (method === "POST" && leadStatusMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const authz = authorizeStaffAction({
          actor,
          allowedRoles: ["commercial", "operations", "tech_admin"],
          requireMfaAal2: false,
        });
        if (!authz.allowed) {
          sendError(res, 403, authz.reasonCode, "Staff commercial/operations role required.", correlationId);
          return;
        }
        const leadId = leadStatusMatch[1] ?? "";
        if (!deps.repository.getCommercialLeadById || !deps.repository.updateCommercialLeadStatus) {
          sendError(res, 501, "NOT_IMPLEMENTED", "Commercial repository not configured.", correlationId);
          return;
        }

        const existingLead = await deps.repository.getCommercialLeadById(leadId);
        if (!existingLead) {
          sendError(res, 404, "COMMERCIAL_LEAD_NOT_FOUND", `Lead ${leadId} not found.`, correlationId);
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const targetStatus = String(body.status ?? "").toUpperCase() as CommercialLeadStatus;
        try {
          const transitioned = transitionCommercialLeadStatus({
            lead: existingLead,
            targetStatus,
            ...(body.convertedOrganizationId !== undefined
              ? {
                  convertedOrganizationId: body.convertedOrganizationId
                    ? String(body.convertedOrganizationId)
                    : null,
                }
              : {}),
            ...(body.notes !== undefined
              ? { notes: body.notes ? String(body.notes) : null }
              : {}),
          });
          const savedLead = await deps.repository.updateCommercialLeadStatus(transitioned);

          await deps.repository.appendAuditLog({
            id: crypto.randomUUID(),
            actorId: actor.id,
            action: "COMMERCIAL_LEAD_STATUS_CHANGED",
            targetType: "COMMERCIAL_LEAD",
            targetId: savedLead.id,
            correlationId,
            reason: `Transitioned lead ${existingLead.status} -> ${savedLead.status}`,
            redactedPayload: {
              previousStatus: existingLead.status,
              newStatus: savedLead.status,
            },
            createdAt: savedLead.updatedAtIso,
          });

          sendJson(res, 200, correlationId, { data: savedLead });
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Invalid lead transition";
          sendError(res, 400, msg.split(":")[0] ?? "COMMERCIAL_LEAD_TRANSITION_ERROR", msg, correlationId);
          return;
        }
      }

      // 20d. POST /v1/commercial/leads/:leadId/proposals
      const leadProposalMatch = pathname.match(/^\/v1\/commercial\/leads\/([^/]+)\/proposals$/);
      if (method === "POST" && leadProposalMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const authz = authorizeStaffAction({
          actor,
          allowedRoles: ["commercial", "operations", "tech_admin"],
          requireMfaAal2: false,
        });
        if (!authz.allowed) {
          sendError(res, 403, authz.reasonCode, "Staff commercial/operations role required.", correlationId);
          return;
        }
        const leadId = leadProposalMatch[1] ?? "";
        if (
          !deps.repository.getCommercialLeadById ||
          !deps.repository.createCommercialProposal ||
          !deps.repository.updateCommercialLeadStatus
        ) {
          sendError(res, 501, "NOT_IMPLEMENTED", "Commercial repository not configured.", correlationId);
          return;
        }

        const existingLead = await deps.repository.getCommercialLeadById(leadId);
        if (!existingLead) {
          sendError(res, 404, "COMMERCIAL_LEAD_NOT_FOUND", `Lead ${leadId} not found.`, correlationId);
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        try {
          const proposal = validateAndBuildCommercialProposal({
            id: body.id ? String(body.id) : crypto.randomUUID(),
            leadId: existingLead.id,
            organizationId: existingLead.convertedOrganizationId,
            proposalVersion: Number(body.proposalVersion ?? 1),
            platformDeliveryCommissionBps: Number(body.platformDeliveryCommissionBps ?? 2100),
            merchantDeliveryCommissionBps: Number(body.merchantDeliveryCommissionBps ?? 1100),
            pickupCommissionBps: Number(body.pickupCommissionBps ?? 900),
            serviceFeeBps: Number(body.serviceFeeBps ?? 500),
            payoutCycleDays: Number(body.payoutCycleDays ?? 7) as 1 | 7 | 14 | 30,
            legalTemplateStatus:
              body.legalTemplateStatus === "APPROVED_TEMPLATE"
                ? "APPROVED_TEMPLATE"
                : "PENDING_LEGAL_REVIEW",
            status: (body.status as CommercialProposalStatus | undefined) ?? "SENT",
            validUntilIso: String(
              body.validUntilIso ??
                new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            ),
            notes: body.notes ? String(body.notes) : null,
            proposedByStaffId: actor.id,
          });

          const savedProposal = await deps.repository.createCommercialProposal(proposal);

          if (existingLead.status === "NEW" || existingLead.status === "QUALIFYING") {
            const updatedLead = transitionCommercialLeadStatus({
              lead: existingLead,
              targetStatus: "PROPOSAL_SENT",
            });
            await deps.repository.updateCommercialLeadStatus(updatedLead);
          }

          await deps.repository.appendAuditLog({
            id: crypto.randomUUID(),
            actorId: actor.id,
            action: "COMMERCIAL_PROPOSAL_CREATED",
            targetType: "COMMERCIAL_PROPOSAL",
            targetId: savedProposal.id,
            correlationId,
            reason: `Created commercial proposal v${savedProposal.proposalVersion} for lead ${existingLead.tradeName}`,
            redactedPayload: {
              leadId: existingLead.id,
              proposalVersion: savedProposal.proposalVersion,
              platformDeliveryCommissionBps: savedProposal.platformDeliveryCommissionBps,
              merchantDeliveryCommissionBps: savedProposal.merchantDeliveryCommissionBps,
              pickupCommissionBps: savedProposal.pickupCommissionBps,
              serviceFeeBps: savedProposal.serviceFeeBps,
              payoutCycleDays: savedProposal.payoutCycleDays,
            },
            createdAt: savedProposal.createdAtIso,
          });

          sendJson(res, 201, correlationId, { data: savedProposal });
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Invalid proposal payload";
          sendError(res, 400, msg.split(":")[0] ?? "COMMERCIAL_PROPOSAL_ERROR", msg, correlationId);
          return;
        }
      }

      // 20e. POST /v1/commercial/proposals/:proposalId/convert
      const proposalConvertMatch = pathname.match(/^\/v1\/commercial\/proposals\/([^/]+)\/convert$/);
      if (method === "POST" && proposalConvertMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const authz = authorizeStaffAction({
          actor,
          allowedRoles: ["commercial", "operations", "tech_admin"],
          requireMfaAal2: false,
        });
        if (!authz.allowed) {
          sendError(res, 403, authz.reasonCode, "Staff commercial/operations role required.", correlationId);
          return;
        }
        const proposalId = proposalConvertMatch[1] ?? "";
        if (
          !deps.repository.getCommercialProposalById ||
          !deps.repository.getCommercialLeadById ||
          !deps.repository.convertCommercialLeadAndProposal
        ) {
          sendError(res, 501, "NOT_IMPLEMENTED", "Commercial repository not configured.", correlationId);
          return;
        }

        const existingProposal = await deps.repository.getCommercialProposalById(proposalId);
        if (!existingProposal) {
          sendError(res, 404, "COMMERCIAL_PROPOSAL_NOT_FOUND", `Proposal ${proposalId} not found.`, correlationId);
          return;
        }
        const existingLead = await deps.repository.getCommercialLeadById(existingProposal.leadId);
        if (!existingLead) {
          sendError(res, 404, "COMMERCIAL_LEAD_NOT_FOUND", `Lead ${existingProposal.leadId} not found.`, correlationId);
          return;
        }

        const { json: body } = await readRawAndJsonBody(req);
        const organizationId = body.organizationId
          ? String(body.organizationId)
          : (existingLead.convertedOrganizationId ?? crypto.randomUUID());
        const storeId = body.storeId ? String(body.storeId) : crypto.randomUUID();
        const slugSuffix = organizationId.slice(0, 8).toLowerCase();
        const baseSlug = existingLead.tradeName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        const organizationSlug = body.organizationSlug
          ? String(body.organizationSlug)
          : `${baseSlug}-${slugSuffix}`;
        const storeSlug = body.storeSlug
          ? String(body.storeSlug)
          : `${baseSlug}-unit-${slugSuffix}`;

        let previousContractVersion = 0;
        if (deps.repository.getMerchantContract) {
          const prev = await deps.repository.getMerchantContract(organizationId);
          if (prev) {
            previousContractVersion = prev.versionNumber;
          }
        }

        try {
          const { updatedProposal, contract, commissionRule } =
            buildVersionedContractAndCommissionRule({
              proposal: existingProposal,
              organizationId,
              contractId: body.contractId ? String(body.contractId) : crypto.randomUUID(),
              commissionRuleId: body.commissionRuleId
                ? String(body.commissionRuleId)
                : crypto.randomUUID(),
              previousContractVersion,
              createdByStaffId: actor.id,
            });

          const leadReadyForConvert =
            existingLead.status === "NEW" || existingLead.status === "QUALIFYING"
              ? transitionCommercialLeadStatus({
                  lead: existingLead,
                  targetStatus: "PROPOSAL_SENT",
                })
              : existingLead;

          const convertedLead =
            leadReadyForConvert.status === "CONVERTED"
              ? leadReadyForConvert
              : transitionCommercialLeadStatus({
                  lead: leadReadyForConvert,
                  targetStatus: "CONVERTED",
                  convertedOrganizationId: organizationId,
                });

          const converted = await deps.repository.convertCommercialLeadAndProposal({
            lead: convertedLead,
            proposal: updatedProposal,
            contract,
            commissionRule,
            organizationId,
            organizationSlug,
            storeId,
            storeSlug,
            partnerOwnerUserId: body.partnerOwnerUserId ? String(body.partnerOwnerUserId) : null,
          });

          await deps.repository.appendAuditLog({
            id: crypto.randomUUID(),
            actorId: actor.id,
            action: "COMMERCIAL_PROPOSAL_CONVERTED_TO_ONBOARDING",
            targetType: "MERCHANT_CONTRACT",
            targetId: converted.contract.id,
            correlationId,
            reason: `Converted proposal ${existingProposal.id} into organization ${organizationId} and contract v${converted.contract.versionNumber}`,
            redactedPayload: {
              leadId: existingLead.id,
              proposalId: existingProposal.id,
              organizationId,
              storeId,
              contractId: converted.contract.id,
              commissionRuleId: converted.commissionRule.id,
              versionNumber: converted.contract.versionNumber,
            },
            createdAt: converted.contract.createdAtIso,
          });

          sendJson(res, 201, correlationId, { data: converted });
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unable to convert commercial proposal";
          sendError(res, 400, msg.split(":")[0] ?? "COMMERCIAL_CONVERT_ERROR", msg, correlationId);
          return;
        }
      }

      // 20f. POST /v1/commercial/contracts/:contractId/accept
      const contractAcceptMatch = pathname.match(/^\/v1\/commercial\/contracts\/([^/]+)\/accept$/);
      if (method === "POST" && contractAcceptMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const contractId = contractAcceptMatch[1] ?? "";
        if (
          !deps.repository.getMerchantContractById ||
          !deps.repository.acceptMerchantContractByPartnerOwner
        ) {
          sendError(res, 501, "NOT_IMPLEMENTED", "Commercial repository not configured.", correlationId);
          return;
        }

        const existingContract = await deps.repository.getMerchantContractById(contractId);
        if (!existingContract) {
          sendError(res, 404, "MERCHANT_CONTRACT_NOT_FOUND", `Contract ${contractId} not found.`, correlationId);
          return;
        }

        try {
          const accepted = evaluatePartnerContractAcceptance({
            contract: existingContract,
            actorId: actor.id,
            actorOrganizationMemberships: actor.organizationMemberships.map((m) => ({
              organizationId: m.organizationId,
              role: m.role,
            })),
          });
          const savedContract = await deps.repository.acceptMerchantContractByPartnerOwner(accepted);

          await deps.repository.appendAuditLog({
            id: crypto.randomUUID(),
            actorId: actor.id,
            action: "MERCHANT_CONTRACT_ACCEPTED_BY_OWNER",
            targetType: "MERCHANT_CONTRACT",
            targetId: savedContract.id,
            correlationId,
            reason: `Partner owner accepted contract v${savedContract.versionNumber}`,
            redactedPayload: {
              organizationId: savedContract.organizationId,
              versionNumber: savedContract.versionNumber,
              acceptedByPartnerOwnerId: savedContract.acceptedByPartnerOwnerId,
              acceptedAtIso: savedContract.acceptedAtIso,
            },
            createdAt: savedContract.acceptedAtIso ?? new Date().toISOString(),
          });

          sendJson(res, 200, correlationId, { data: savedContract });
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Contract acceptance forbidden";
          const code = msg.split(":")[0] ?? "CONTRACT_ACCEPTANCE_ERROR";
          const statusCode = code.includes("PARTNER_OWNER_REQUIRED") ? 403 : 400;
          sendError(res, statusCode, code, msg, correlationId);
          return;
        }
      }

      // 20g. GET /v1/partner/organizations/:organizationId/commission-rules
      const orgCommRulesMatch = pathname.match(
        /^\/v1\/partner\/organizations\/([^/]+)\/commission-rules$/
      );
      if (method === "GET" && orgCommRulesMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const organizationId = orgCommRulesMatch[1] ?? "";
        const partnerDecision = authorizePartnerScope({
          actor,
          organizationId,
          allowedRoles: ["partner_owner", "partner_finance"],
        });
        const staffDecision = authorizeStaffAction({
          actor,
          allowedRoles: ["commercial", "finance", "risk_compliance", "tech_admin"],
          requireMfaAal2: false,
        });
        if (!partnerDecision.allowed && !staffDecision.allowed) {
          sendError(
            res,
            403,
            partnerDecision.reasonCode,
            "Access restricted to partner_owner/partner_finance or authorized staff.",
            correlationId
          );
          return;
        }
        if (!deps.repository.listCommissionRuleVersions) {
          sendError(res, 501, "NOT_IMPLEMENTED", "Commercial repository not configured.", correlationId);
          return;
        }
        const rules = await deps.repository.listCommissionRuleVersions(organizationId);
        sendJson(res, 200, correlationId, { data: rules });
        return;
      }

      sendError(
        res,
        404,
        "ROUTE_NOT_FOUND",
        `Route ${method} ${pathname} not found.`,
        correlationId
      );
    } catch (err) {
      createStructuredLogEntry({
        level: "ERROR",
        service: "@ideliveryfood/api",
        correlationId,
        message: err instanceof Error ? err.message : "Unhandled API error",
      });
      sendError(
        res,
        500,
        "INTERNAL_SERVER_ERROR",
        "An unexpected server error occurred.",
        correlationId
      );
    }
  });
}
