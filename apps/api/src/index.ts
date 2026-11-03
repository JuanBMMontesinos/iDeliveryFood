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
  DEFAULT_LOCALE,
  resolveSupportedLocale,
  type ApiErrorEnvelope,
  type AuthenticatedActorProfileContract,
  type PaginatedResponse,
  type PublishedStoreContract,
  type SupportedLocale,
  type UserPreferencesContract,
} from "@ideliveryfood/contracts";
import {
  calculateServerQuoteAndSplit,
  evaluateAccountDeletionRequest,
  type QuoteItemInput,
} from "@ideliveryfood/domain";

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
  getActorById(userId: string, aal: "aal1" | "aal2"): Promise<AuthenticatedActorProfileContract | null>;
  updateUserPreferences(
    userId: string,
    locale: SupportedLocale
  ): Promise<UserPreferencesContract>;
  listOrganizationMembers(organizationId: string): Promise<
    Array<{
      userId: string;
      organizationId: string;
      storeId: string | null;
      role: string;
    }>
  >;
  saveInvitation(record: StoredInvitationRecord): Promise<void>;
  getInvitationById(id: string): Promise<StoredInvitationRecord | null>;
  markInvitationConsumed(id: string, consumedAtIso: string): Promise<void>;
  appendAuditLog(entry: AuditLogWriteRecord): Promise<void>;
  getAuditLogs(): Promise<AuditLogWriteRecord[]>;
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

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

export function createApiServer(deps: {
  repository: ApiDataRepository;
  env?: Record<string, string | undefined>;
}): http.Server {
  const env = deps.env ?? process.env;

  return http.createServer(async (req, res) => {
    const correlationId =
      (req.headers["x-correlation-id"] as string | undefined) ?? `corr_${Date.now()}`;
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

      // 4. Public Published Stores Discovery
      if (method === "GET" && pathname === "/v1/stores") {
        const queryLocale = resolveSupportedLocale(parsedUrl.searchParams.get("locale") ?? locale);
        const stores = await deps.repository.listPublishedStores(queryLocale);
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

      // Extract authenticated actor headers for protected routes
      const actorId = req.headers["x-actor-id"] as string | undefined;
      const actorAal = (req.headers["x-actor-aal"] as "aal1" | "aal2" | undefined) ?? "aal1";
      const actor = actorId ? await deps.repository.getActorById(actorId, actorAal) : null;

      // 5. GET /v1/me
      if (method === "GET" && pathname === "/v1/me") {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        sendJson(res, 200, correlationId, { data: actor });
        return;
      }

      // 6. PATCH /v1/me/preferences (Language en / pt-BR persistence)
      if (method === "PATCH" && pathname === "/v1/me/preferences") {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
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
        const body = await readJsonBody(req);
        const targetLocale = resolveSupportedLocale(String(body.locale ?? DEFAULT_LOCALE));
        const updated = await deps.repository.updateUserPreferences(actor.id, targetLocale);

        await deps.repository.appendAuditLog({
          id: `aud_${Date.now()}`,
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
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const body = await readJsonBody(req);
        const deviceId = String(body.deviceId ?? "");
        if (!deviceId) {
          sendError(res, 400, "VALIDATION_ERROR", "deviceId is required.", correlationId);
          return;
        }

        await deps.repository.appendAuditLog({
          id: `aud_${Date.now()}`,
          actorId: actor.id,
          action: "DEVICE_SESSION_REVOKED",
          targetType: "USER_DEVICE",
          targetId: deviceId,
          correlationId,
          reason: "User initiated device session revocation",
          redactedPayload: { deviceId },
          createdAt: new Date().toISOString(),
        });

        sendJson(res, 200, correlationId, {
          status: "REVOKED",
          deviceId,
          revokedAt: new Date().toISOString(),
        });
        return;
      }

      // 8. POST /v1/me/privacy-requests (LGPD Deletion & Legal Hold Check)
      if (method === "POST" && pathname === "/v1/me/privacy-requests") {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const body = await readJsonBody(req);
        const evaluation = evaluateAccountDeletionRequest({
          userId: actor.id,
          hasActiveOrders: Boolean(body.hasActiveOrders),
          hasOpenFinancialDisputes: Boolean(body.hasOpenFinancialDisputes),
          hasCompletedFiscalTransactions: Boolean(body.hasCompletedFiscalTransactions),
          requestedAt: new Date(),
        });

        await deps.repository.appendAuditLog({
          id: `aud_${Date.now()}`,
          actorId: actor.id,
          action: "PRIVACY_DELETION_EVALUATED",
          targetType: "PROFILE",
          targetId: actor.id,
          correlationId,
          reason: evaluation.reasonCode,
          redactedPayload: { outcome: evaluation.outcome, holdUntilIso: evaluation.holdUntilIso },
          createdAt: new Date().toISOString(),
        });

        sendJson(res, 201, correlationId, { data: evaluation });
        return;
      }

      // 9. GET /v1/organizations/:orgId/members (Multi-Tenant Isolation Check)
      const orgMembersMatch = pathname.match(/^\/v1\/organizations\/([^/]+)\/members$/);
      if (method === "GET" && orgMembersMatch) {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const orgId = orgMembersMatch[1] ?? "";
        const decision = authorizePartnerScope({
          actor,
          organizationId: orgId,
          allowedRoles: ["partner_owner", "partner_manager"],
        });

        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Cross-tenant or role access denied.", correlationId);
          return;
        }

        const members = await deps.repository.listOrganizationMembers(orgId);
        sendJson(res, 200, correlationId, { data: members });
        return;
      }

      // 10. POST /v1/invitations & POST /v1/invitations/accept
      if (method === "POST" && pathname === "/v1/invitations") {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const body = await readJsonBody(req);
        const organizationId = String(body.organizationId ?? "");
        const decision = authorizePartnerScope({
          actor,
          organizationId,
          allowedRoles: ["partner_owner", "partner_manager"],
        });
        if (!decision.allowed) {
          sendError(res, 403, decision.reasonCode, "Not authorized to invite members.", correlationId);
          return;
        }

        const rawToken = String(body.rawToken ?? "");
        const invitationId = String(body.id ?? `inv_${Date.now()}`);
        const record: StoredInvitationRecord = {
          id: invitationId,
          email: String(body.email ?? ""),
          tokenHash: hashInvitationToken(rawToken),
          expiresAtIso: String(body.expiresAtIso ?? new Date(Date.now() + 86400000).toISOString()),
          consumedAtIso: null,
        };
        await deps.repository.saveInvitation(record);
        sendJson(res, 201, correlationId, {
          id: record.id,
          email: record.email,
          expiresAtIso: record.expiresAtIso,
        });
        return;
      }

      if (method === "POST" && pathname === "/v1/invitations/accept") {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const body = await readJsonBody(req);
        const invitationId = String(body.invitationId ?? "");
        const rawToken = String(body.rawToken ?? "");
        const stored = await deps.repository.getInvitationById(invitationId);
        if (!stored) {
          sendError(res, 404, "INVITATION_NOT_FOUND", "Invitation not found.", correlationId);
          return;
        }

        const check = validateInvitationAcceptance({
          rawToken,
          actorEmail: actor.email,
          invitation: stored,
        });
        if (!check.valid) {
          sendError(res, 400, `INVITATION_${check.reasonCode}`, "Invalid or expired invitation.", correlationId);
          return;
        }

        const consumedAtIso = new Date().toISOString();
        await deps.repository.markInvitationConsumed(stored.id, consumedAtIso);
        sendJson(res, 200, correlationId, { status: "ACCEPTED", consumedAtIso });
        return;
      }

      // 11. POST /v1/onboarding/approvals (Requires Internal Staff + MFA aal2)
      if (method === "POST" && pathname === "/v1/onboarding/approvals") {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const staffDecision = authorizeStaffAction({
          actor,
          allowedRoles: ["operations", "commercial", "risk_compliance", "tech_admin"],
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

        const body = await readJsonBody(req);
        const targetId = String(body.targetId ?? "");
        const decision = String(body.decision ?? "APPROVED");
        const reason = String(body.reason ?? "");

        await deps.repository.appendAuditLog({
          id: `aud_${Date.now()}`,
          actorId: actor.id,
          action: `ONBOARDING_${decision}`,
          targetType: String(body.targetType ?? "STORE"),
          targetId,
          correlationId,
          reason,
          redactedPayload: { decision, targetId },
          createdAt: new Date().toISOString(),
        });

        sendJson(res, 200, correlationId, {
          status: decision,
          targetId,
          approvedBy: actor.id,
        });
        return;
      }

      // 12. POST /v1/quotes (Authoritative Server-Side Quote in BRL Cents)
      if (method === "POST" && pathname === "/v1/quotes") {
        if (!actor) {
          sendError(res, 401, "AUTH_UNAUTHORIZED", "Authentication required.", correlationId);
          return;
        }
        const body = await readJsonBody(req);
        const quote = calculateServerQuoteAndSplit({
          items: (body.items as QuoteItemInput[]) ?? [],
          fulfillmentModality: (body.fulfillmentModality as "PLATFORM_DELIVERY" | "MERCHANT_DELIVERY" | "PICKUP") ?? "PLATFORM_DELIVERY",
          deliveryFeeCents: Number(body.deliveryFeeCents ?? 0),
          discountCents: Number(body.discountCents ?? 0),
          discountFundedBy: (body.discountFundedBy as "PLATFORM" | "MERCHANT" | "NONE") ?? "NONE",
          minOrderCents: Number(body.minOrderCents ?? 0),
        });
        sendJson(res, 201, correlationId, { data: quote });
        return;
      }

      sendError(res, 404, "ROUTE_NOT_FOUND", `Route ${method} ${pathname} not found.`, correlationId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected internal server error";
      createStructuredLogEntry({
        level: "ERROR",
        service: "@ideliveryfood/api",
        correlationId,
        message,
      });
      sendError(res, 500, "INTERNAL_SERVER_ERROR", message, correlationId);
    }
  });
}
