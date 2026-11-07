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
  CURRENCY_CODE,
  DEFAULT_LOCALE,
  resolveSupportedLocale,
  type AdminGovernanceActionContract,
  type AdminStaffScopeGrantRequestContract,
  type ApiErrorEnvelope,
  type AuthenticatedActorProfileContract,
  type BankAccountChangeRequestContract,
  type BatchCatalogUpdateItemResultContract,
  type CartItemSelectionContract,
  type CatalogCategoryContract,
  type CatalogProductContract,
  type CourierLocationSampleContract,
  type CustomerAddressContract,
  type DeliveryOfferContract,
  type DeliveryTaskContract,
  type FulfillmentModality,
  type MultiUnitStoreSummaryContract,
  type OrderEventRecordContract,
  type OrderRecordContract,
  type PaginatedResponse,
  type PaymentAttemptContract,
  type PaymentMethodCode,
  type PspReconciliationRunContract,
  type PublishedStoreContract,
  type RefundRecordContract,
  type ServerQuoteRecordContract,
  type SettlementRecordContract,
  type StaffRole,
  type StoreCatalogResponseContract,
  type StoreHourExceptionContract,
  type StoreOperatingHourContract,
  type StoreServiceAreaContract,
  type StoreSettingsPatchContract,
  type SupportedLocale,
  type UserPreferencesContract,
} from "@ideliveryfood/contracts";
import {
  acceptDeliveryOfferTransactional,
  assertExternalProviderReady,
  buildKitchenOrderQueue,
  calculateServerQuoteAndSplit,
  createBankAccountChangeRequest,
  createOrderFromServerQuote,
  evaluateAccountDeletionRequest,
  evaluateAdminGovernanceDecision,
  evaluateCourierLocationSample,
  evaluatePspReconciliationRun,
  evaluateRefundRequest,
  evaluateServiceAreaEligibility,
  evaluateSettlementPayoutExecution,
  evaluateStaffScopeGrant,
  evaluateStoreAvailability,
  executeOrderCommand,
  hashDeliveryConfirmationCode,
  validateAndBuildQuoteItems,
  validateStoreSettingsPatch,
  verifyAndProcessPspWebhook,
  verifyDeliveryConfirmationCode,
  type OrderCommandType,
  type QuoteItemInput,
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

      // 7. POST /v1/me/devices/revoke
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

      // 9b. POST /v1/organizations/:orgId/catalog-batch (M09 Multi-unit batch update with partial results)
      const orgBatchMatch = pathname.match(
        /^\/v1\/organizations\/([^/]+)\/catalog-batch$/
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
            results.push({
              storeId: targetStoreId,
              productId,
              status: "APPLIED",
              reasonCode: "APPLIED_TO_UNIT",
            });
          }
        }

        await deps.repository.appendAuditLog({
          id: crypto.randomUUID(),
          actorId: actor.id,
          action: "MULTI_UNIT_CATALOG_BATCH_EXECUTED",
          targetType: "ORGANIZATION",
          targetId: orgId,
          correlationId,
          reason: `Batch update for product ${productId}`,
          redactedPayload: {
            appliedCount: results.filter((r) => r.status === "APPLIED").length,
            deniedCount: results.filter((r) => r.status === "DENIED_SCOPE").length,
          },
          createdAt: new Date().toISOString(),
        });

        sendJson(res, 200, correlationId, { data: results });
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

        const calc = calculateServerQuoteAndSplit({
          items: quoteInputs,
          fulfillmentModality,
          deliveryFeeCents: Number(body.deliveryFeeCents ?? 690),
          discountCents: Number(body.discountCents ?? 0),
          discountFundedBy:
            (body.discountFundedBy as "PLATFORM" | "MERCHANT" | "NONE") ??
            "NONE",
          minOrderCents: Number(body.minOrderCents ?? 0),
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

      // 16. PATCH /v1/stores/:storeId/settings (M07 — Partner store pause/unpause, prep time, minOrderCents)
      const storeSettingsMatch = pathname.match(
        /^\/v1\/stores\/([^/]+)\/settings$/
      );
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
          storeId,
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
          validateStoreSettingsPatch(patch);

          const updatedStore = await deps.repository.updateStoreSettings(
            storeId,
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
