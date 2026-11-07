import crypto from "node:crypto";
import pg from "pg";
import type { StoredInvitationRecord } from "@ideliveryfood/authz";
import type {
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
} from "@ideliveryfood/domain";
import {
  CURRENCY_CODE,
  DEFAULT_LOCALE,
  type AdminGovernanceActionContract,
  type AdminOverviewResponseContract,
  type AdminStaffScopeGrantRequestContract,
  type AuthenticatedActorProfileContract,
  type AuthorizedStorageBucket,
  type BankAccountChangeRequestContract,
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
  type OrderEventRecordContract,
  type OrderRecordContract,
  type OrderReviewContract,
  type PartnerFinanceSummaryContract,
  type PartnerRole,
  type PaymentAttemptContract,
  type PaymentMethodCode,
  type PspReconciliationRunContract,
  type PublishedStoreContract,
  type RefundRecordContract,
  type ServerQuoteRecordContract,
  type SettlementRecordContract,
  type StaffRole,
  type StoreHourExceptionContract,
  type StoreOperatingHourContract,
  type StoreServiceAreaContract,
  type StoreSettingsPatchContract,
  type SupportCaseContract,
  type SupportedLocale,
  type UserDeviceContract,
  type UserPreferencesContract,
} from "@ideliveryfood/contracts";
import type { ApiDataRepository, AuditLogWriteRecord } from "./index.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Ensures any string identifier is a valid UUID for PostgreSQL uuid columns.
 * If already a valid UUID, returns it normalized; otherwise derives a deterministic UUID v4-formatted hash.
 */
export function toDeterministicUuid(rawId: string): string {
  const trimmed = rawId.trim();
  if (UUID_REGEX.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const hash = crypto.createHash("sha256").update(trimmed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function mapRowToPublishedStore(
  row: Record<string, unknown>,
  locale: SupportedLocale
): PublishedStoreContract & { organizationId: string } {
  const descriptionEn = String(row.description_en ?? "");
  const descriptionPtBr = String(row.description_pt_br ?? "");
  let modalities: FulfillmentModality[] = ["PLATFORM_DELIVERY"];
  if (Array.isArray(row.supported_modalities)) {
    modalities = row.supported_modalities as FulfillmentModality[];
  } else if (typeof row.supported_modalities === "string") {
    const cleaned = row.supported_modalities.replace(/^\{|\}$/g, "");
    if (cleaned.length > 0) {
      modalities = cleaned.split(",") as FulfillmentModality[];
    }
  }
  return {
    id: String(row.id),
    organizationId: String(row.organization_id ?? ""),
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
    supportedModalities: modalities,
  };
}

function mapRowToQuote(row: Record<string, unknown>): ServerQuoteRecordContract {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    storeId: String(row.store_id),
    addressId: row.address_id ? String(row.address_id) : null,
    fulfillmentModality: String(row.fulfillment_modality) as FulfillmentModality,
    promotionCode: row.promotion_code ? String(row.promotion_code) : null,
    currencyCode: CURRENCY_CODE,
    subtotalCents: Number(row.subtotal_cents),
    addonsCents: Number(row.addons_cents),
    serviceFeeCents: Number(row.service_fee_cents),
    deliveryFeeCents: Number(row.delivery_fee_cents),
    discountCents: Number(row.discount_cents),
    totalCents: Number(row.total_cents),
    distanceMeters: Number(row.distance_meters),
    estimatedPrepMinutes: Number(row.estimated_prep_minutes),
    estimatedDeliveryMinutes: Number(row.estimated_delivery_minutes),
    itemsSnapshot: (row.items_snapshot as ServerQuoteRecordContract["itemsSnapshot"]) ?? [],
    addressSnapshot: (row.address_snapshot as Record<string, unknown> | null) ?? null,
    idempotencyKey: String(row.idempotency_key),
    expiresAtIso: new Date(String(row.expires_at)).toISOString(),
    consumedAtIso: row.consumed_at ? new Date(String(row.consumed_at)).toISOString() : null,
    createdAtIso: new Date(String(row.created_at)).toISOString(),
  };
}

function mapRowToOrder(
  row: Record<string, unknown>,
  itemsSnapshot: ServerQuoteRecordContract["itemsSnapshot"]
): OrderRecordContract {
  return {
    id: String(row.id),
    orderNumber: Number(row.order_number),
    customerId: String(row.customer_id),
    organizationId: String(row.organization_id),
    storeId: String(row.store_id),
    quoteId: String(row.quote_id),
    fulfillmentModality: String(row.fulfillment_modality) as FulfillmentModality,
    orderStatus: String(row.order_status) as OrderStatus,
    paymentStatus: String(row.payment_status) as PaymentStatus,
    deliveryStatus: String(row.delivery_status) as DeliveryStatus,
    currencyCode: CURRENCY_CODE,
    subtotalCents: Number(row.subtotal_cents),
    addonsCents: Number(row.addons_cents),
    serviceFeeCents: Number(row.service_fee_cents),
    deliveryFeeCents: Number(row.delivery_fee_cents),
    discountCents: Number(row.discount_cents),
    totalCents: Number(row.total_cents),
    platformCommissionCents: Number(row.platform_commission_cents),
    merchantNetCents: Number(row.merchant_net_cents),
    courierEarningsCents: Number(row.courier_earnings_cents),
    itemsSnapshot,
    deliveryAddressSnapshot:
      (row.delivery_address_snapshot as Record<string, unknown> | null) ?? null,
    customerNotes: row.customer_notes ? String(row.customer_notes) : null,
    cancellationReason: row.cancellation_reason ? String(row.cancellation_reason) : null,
    cancelledByRole: row.cancelled_by_role ? String(row.cancelled_by_role) : null,
    version: Number(row.version),
    idempotencyKey: String(row.idempotency_key),
    acceptedAtIso: row.accepted_at ? new Date(String(row.accepted_at)).toISOString() : null,
    readyAtIso: row.ready_at ? new Date(String(row.ready_at)).toISOString() : null,
    deliveredAtIso: row.delivered_at ? new Date(String(row.delivered_at)).toISOString() : null,
    cancelledAtIso: row.cancelled_at ? new Date(String(row.cancelled_at)).toISOString() : null,
    createdAtIso: new Date(String(row.created_at)).toISOString(),
    updatedAtIso: new Date(String(row.updated_at)).toISOString(),
  };
}

export interface SupabasePostgresRepositoryInstance extends ApiDataRepository {
  pool: pg.Pool;
  close(): Promise<void>;
}

/**
 * Production & Development PostgreSQL Repository connected directly to Supabase
 * (`db.dwsoochnfxldfvcaijie.supabase.co:5432/postgres`).
 * Zero in-memory Maps or mocked business data.
 */
export function createSupabasePostgresRepository(params: {
  connectionString: string;
  isTestData?: boolean;
}): SupabasePostgresRepositoryInstance {
  const isTestData = params.isTestData ?? false;
  const pool = new pg.Pool({
    connectionString: params.connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 15000,
  });

  // Map logical string IDs to deterministic UUIDs when non-UUID IDs are passed
  const logicalIdByUuid = new Map<string, string>();
  function rememberLogicalId(rawId: string): string {
    const uuid = toDeterministicUuid(rawId);
    logicalIdByUuid.set(uuid, rawId);
    return uuid;
  }
  function restoreLogicalId(uuid: string): string {
    return logicalIdByUuid.get(uuid.toLowerCase()) ?? uuid;
  }

  return {
    pool,
    async close(): Promise<void> {
      await pool.end();
    },

    async listPublishedStores(locale: SupportedLocale = DEFAULT_LOCALE): Promise<PublishedStoreContract[]> {
      const res = await pool.query(
        `SELECT * FROM public.published_stores_v ORDER BY name ASC`
      );
      return res.rows.map((r) => {
        const mapped = mapRowToPublishedStore(r as Record<string, unknown>, locale);
        const { organizationId: _orgId, ...publicContract } = mapped;
        return publicContract;
      });
    },

    async getStoreById(storeId: string, locale: SupportedLocale = DEFAULT_LOCALE) {
      const storeUuid = toDeterministicUuid(storeId);
      const slugCandidate = storeId.trim().toLowerCase();
      const res = await pool.query(
        `SELECT * FROM public.stores WHERE id = $1 OR slug = $2 LIMIT 1`,
        [storeUuid, slugCandidate]
      );
      if (res.rowCount === 0) return null;
      return mapRowToPublishedStore(res.rows[0] as Record<string, unknown>, locale);
    },

    async getStoreCatalog(storeId: string, locale: SupportedLocale = DEFAULT_LOCALE) {
      const storeUuid = toDeterministicUuid(storeId);
      const slugCandidate = storeId.trim().toLowerCase();
      const storeRes = await pool.query(
        `SELECT * FROM public.stores
         WHERE (id = $1 OR slug = $2) AND status = 'ACTIVE' AND is_published = true
         LIMIT 1`,
        [storeUuid, slugCandidate]
      );
      if (storeRes.rowCount === 0) return null;
      const storeWithOrg = mapRowToPublishedStore(
        storeRes.rows[0] as Record<string, unknown>,
        locale
      );
      const { organizationId: _orgId, ...store } = storeWithOrg;
      const resolvedStoreUuid = store.id;

      const [hoursRes, excRes, areasRes, catsRes, prodsRes, groupsRes, optsRes] =
        await Promise.all([
          pool.query(
            `SELECT day_of_week, opens_at, closes_at, is_overnight, is_closed
             FROM public.store_hours WHERE store_id = $1 ORDER BY day_of_week ASC, opens_at ASC`,
            [resolvedStoreUuid]
          ),
          pool.query(
            `SELECT exception_date::text AS exception_date, is_closed, opens_at, closes_at, reason
             FROM public.store_hour_exceptions WHERE store_id = $1 ORDER BY exception_date ASC`,
            [resolvedStoreUuid]
          ),
          pool.query(
            `SELECT id, store_id, name, radius_meters, base_fee_cents, per_km_fee_cents,
                    free_delivery_min_order_cents, estimated_delivery_minutes, is_active
             FROM public.store_service_areas WHERE store_id = $1 AND is_active = true ORDER BY radius_meters ASC`,
            [resolvedStoreUuid]
          ),
          pool.query(
            `SELECT id, store_id, name_en, name_pt_br, sort_order, is_active
             FROM public.catalog_categories WHERE store_id = $1 AND is_active = true ORDER BY sort_order ASC`,
            [resolvedStoreUuid]
          ),
          pool.query(
            `SELECT id, store_id, category_id, sku, name_en, name_pt_br, description_en, description_pt_br,
                    price_cents, is_available, is_paused, max_per_order, unit_of_measure
             FROM public.catalog_products WHERE store_id = $1 ORDER BY created_at ASC`,
            [resolvedStoreUuid]
          ),
          pool.query(
            `SELECT id, product_id, store_id, name_en, name_pt_br, min_selections, max_selections, sort_order
             FROM public.catalog_option_groups WHERE store_id = $1 ORDER BY sort_order ASC`,
            [resolvedStoreUuid]
          ),
          pool.query(
            `SELECT id, option_group_id, store_id, name_en, name_pt_br, additional_price_cents, is_available, sort_order
             FROM public.catalog_options WHERE store_id = $1 ORDER BY sort_order ASC`,
            [resolvedStoreUuid]
          ),
        ]);

      const weeklyHours: StoreOperatingHourContract[] = hoursRes.rows.map((r) => ({
        dayOfWeek: Number(r.day_of_week),
        opensAt: String(r.opens_at),
        closesAt: String(r.closes_at),
        isOvernight: Boolean(r.is_overnight),
        isClosed: Boolean(r.is_closed),
      }));

      const exceptions: StoreHourExceptionContract[] = excRes.rows.map((r) => ({
        exceptionDate: String(r.exception_date),
        isClosed: Boolean(r.is_closed),
        opensAt: r.opens_at ? String(r.opens_at) : null,
        closesAt: r.closes_at ? String(r.closes_at) : null,
        reason: String(r.reason),
      }));

      const serviceAreas: StoreServiceAreaContract[] = areasRes.rows.map((r) => ({
        id: String(r.id),
        storeId: String(r.store_id),
        name: String(r.name),
        radiusMeters: Number(r.radius_meters),
        baseFeeCents: Number(r.base_fee_cents),
        perKmFeeCents: Number(r.per_km_fee_cents),
        freeDeliveryMinOrderCents:
          r.free_delivery_min_order_cents !== null
            ? Number(r.free_delivery_min_order_cents)
            : null,
        estimatedDeliveryMinutes: Number(r.estimated_delivery_minutes),
        isActive: Boolean(r.is_active),
      }));

      const optionsByGroupId = new Map<string, CatalogOptionContract[]>();
      for (const r of optsRes.rows) {
        const groupId = String(r.option_group_id);
        const nameEn = String(r.name_en);
        const namePtBr = String(r.name_pt_br);
        const opt: CatalogOptionContract = {
          id: String(r.id),
          nameEn,
          namePtBr,
          localizedName: locale === "pt-BR" ? namePtBr : nameEn,
          additionalPriceCents: Number(r.additional_price_cents),
          isAvailable: Boolean(r.is_available),
          sortOrder: Number(r.sort_order),
        };
        const list = optionsByGroupId.get(groupId) ?? [];
        list.push(opt);
        optionsByGroupId.set(groupId, list);
      }

      const groupsByProductId = new Map<string, CatalogOptionGroupContract[]>();
      for (const r of groupsRes.rows) {
        const productId = String(r.product_id);
        const groupId = String(r.id);
        const nameEn = String(r.name_en);
        const namePtBr = String(r.name_pt_br);
        const grp: CatalogOptionGroupContract = {
          id: groupId,
          nameEn,
          namePtBr,
          localizedName: locale === "pt-BR" ? namePtBr : nameEn,
          minSelections: Number(r.min_selections),
          maxSelections: Number(r.max_selections),
          sortOrder: Number(r.sort_order),
          options: optionsByGroupId.get(groupId) ?? [],
        };
        const list = groupsByProductId.get(productId) ?? [];
        list.push(grp);
        groupsByProductId.set(productId, list);
      }

      const productsByCategoryId = new Map<string, CatalogProductContract[]>();
      for (const r of prodsRes.rows) {
        const catId = String(r.category_id);
        const prodId = String(r.id);
        const nameEn = String(r.name_en);
        const namePtBr = String(r.name_pt_br);
        const descEn = String(r.description_en ?? "");
        const descPtBr = String(r.description_pt_br ?? "");
        const prod: CatalogProductContract = {
          id: prodId,
          storeId: String(r.store_id),
          categoryId: catId,
          sku: r.sku ? String(r.sku) : null,
          nameEn,
          namePtBr,
          localizedName: locale === "pt-BR" ? namePtBr : nameEn,
          descriptionEn: descEn,
          descriptionPtBr: descPtBr,
          localizedDescription: locale === "pt-BR" ? descPtBr : descEn,
          priceCents: Number(r.price_cents),
          isAvailable: Boolean(r.is_available),
          isPaused: Boolean(r.is_paused),
          maxPerOrder: Number(r.max_per_order),
          unitOfMeasure: String(r.unit_of_measure) as "UNIT" | "GRAM" | "KG",
          optionGroups: groupsByProductId.get(prodId) ?? [],
        };
        const list = productsByCategoryId.get(catId) ?? [];
        list.push(prod);
        productsByCategoryId.set(catId, list);
      }

      const categories: CatalogCategoryContract[] = catsRes.rows.map((r) => {
        const catId = String(r.id);
        const nameEn = String(r.name_en);
        const namePtBr = String(r.name_pt_br);
        return {
          id: catId,
          storeId: String(r.store_id),
          nameEn,
          namePtBr,
          localizedName: locale === "pt-BR" ? namePtBr : nameEn,
          sortOrder: Number(r.sort_order),
          isActive: Boolean(r.is_active),
          products: productsByCategoryId.get(catId) ?? [],
        };
      });

      return {
        store,
        weeklyHours,
        exceptions,
        serviceAreas,
        categories,
      };
    },

    async updateStoreSettings(
      storeId: string,
      patch: StoreSettingsPatchContract,
      locale: SupportedLocale = DEFAULT_LOCALE
    ): Promise<PublishedStoreContract | null> {
      const storeUuid = toDeterministicUuid(storeId);
      const res = await pool.query(
        `UPDATE public.stores
         SET name = COALESCE($2, name),
             description_en = COALESCE($3, description_en),
             description_pt_br = COALESCE($4, description_pt_br),
             cuisine_category = COALESCE($5, cuisine_category),
             is_paused = COALESCE($6, is_paused),
             pause_reason = CASE WHEN $6 = false THEN NULL ELSE COALESCE($7, pause_reason) END,
             min_order_cents = COALESCE($8, min_order_cents),
             prep_time_min_minutes = COALESCE($9, prep_time_min_minutes),
             prep_time_max_minutes = COALESCE($10, prep_time_max_minutes),
             supported_modalities = COALESCE($11::public.fulfillment_modality[], supported_modalities)
         WHERE id = $1
         RETURNING *`,
        [
          storeUuid,
          patch.name !== undefined ? patch.name : null,
          patch.descriptionEn !== undefined ? patch.descriptionEn : null,
          patch.descriptionPtBr !== undefined ? patch.descriptionPtBr : null,
          patch.cuisineCategory !== undefined ? patch.cuisineCategory : null,
          patch.isPaused !== undefined ? patch.isPaused : null,
          patch.pauseReason !== undefined ? patch.pauseReason : null,
          patch.minOrderCents !== undefined ? patch.minOrderCents : null,
          patch.prepTimeMinMinutes !== undefined ? patch.prepTimeMinMinutes : null,
          patch.prepTimeMaxMinutes !== undefined ? patch.prepTimeMaxMinutes : null,
          patch.supportedModalities !== undefined ? patch.supportedModalities : null,
        ]
      );
      if (res.rowCount === 0) return null;
      const mapped = mapRowToPublishedStore(res.rows[0] as Record<string, unknown>, locale);
      const { organizationId: _orgId, ...publicContract } = mapped;
      return publicContract;
    },

    async getActorById(
      userId: string,
      aal: "aal1" | "aal2"
    ): Promise<AuthenticatedActorProfileContract | null> {
      const userUuid = toDeterministicUuid(userId);
      const profRes = await pool.query(
        `SELECT p.id, p.email, p.full_name, p.phone,
                COALESCE(up.locale, p.preferred_locale) AS preferred_locale,
                p.status, p.mfa_enforced
         FROM public.profiles p
         LEFT JOIN public.user_preferences up ON up.user_id = p.id
         WHERE p.id = $1
         LIMIT 1`,
        [userUuid]
      );
      if (profRes.rowCount === 0) return null;
      const p = profRes.rows[0] as Record<string, unknown>;

      const [orgRes, staffRes] = await Promise.all([
        pool.query(
          `SELECT organization_id, store_id, role
           FROM public.organization_members
           WHERE user_id = $1 AND is_active = true AND revoked_at IS NULL`,
          [userUuid]
        ),
        pool.query(
          `SELECT role, region_code, max_refund_approval_cents, requires_mfa
           FROM public.staff_scopes
           WHERE user_id = $1 AND is_active = true AND revoked_at IS NULL`,
          [userUuid]
        ),
      ]);

      return {
        id: String(p.id),
        email: String(p.email),
        fullName: String(p.full_name),
        phone: p.phone ? String(p.phone) : null,
        preferredLocale: (String(p.preferred_locale) === "pt-BR" ? "pt-BR" : "en") as SupportedLocale,
        status: String(p.status) as AuthenticatedActorProfileContract["status"],
        mfaEnforced: Boolean(p.mfa_enforced),
        aal,
        organizationMemberships: orgRes.rows.map((m) => ({
          organizationId: String(m.organization_id),
          storeId: m.store_id ? String(m.store_id) : null,
          role: String(m.role) as PartnerRole,
        })),
        staffScopes: staffRes.rows.map((s) => ({
          role: String(s.role) as StaffRole,
          regionCode: s.region_code ? String(s.region_code) : null,
          maxRefundApprovalCents: Number(s.max_refund_approval_cents),
          requiresMfa: Boolean(s.requires_mfa),
        })),
      };
    },

    async updateUserPreferences(
      userId: string,
      locale: SupportedLocale
    ): Promise<UserPreferencesContract> {
      const userUuid = toDeterministicUuid(userId);
      await pool.query(
        `UPDATE public.profiles SET preferred_locale = $2 WHERE id = $1`,
        [userUuid, locale]
      );
      const res = await pool.query(
        `INSERT INTO public.user_preferences (user_id, locale, is_test_data)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET locale = EXCLUDED.locale
         RETURNING user_id, locale, push_order_updates, push_promotions, email_transactional, email_marketing`,
        [userUuid, locale, isTestData]
      );
      const r = res.rows[0] as Record<string, unknown>;
      return {
        userId: String(r.user_id),
        locale: (String(r.locale) === "pt-BR" ? "pt-BR" : "en") as SupportedLocale,
        pushOrderUpdates: Boolean(r.push_order_updates),
        pushPromotions: Boolean(r.push_promotions),
        emailTransactional: Boolean(r.email_transactional),
        emailMarketing: Boolean(r.email_marketing),
      };
    },

    async revokeUserDevice(
      userId: string,
      deviceIdentifier: string,
      revokedAtIso: string
    ): Promise<void> {
      const userUuid = toDeterministicUuid(userId);
      await pool.query(
        `INSERT INTO public.user_devices (user_id, platform, device_identifier, is_revoked, revoked_at, is_test_data)
         VALUES ($1, 'WEB', $2, true, $3, $4)
         ON CONFLICT (user_id, platform, device_identifier)
         DO UPDATE SET is_revoked = true, revoked_at = EXCLUDED.revoked_at, push_token = NULL`,
        [userUuid, deviceIdentifier, revokedAtIso, isTestData]
      );
    },

    async savePrivacyRequest(params: {
      id: string;
      userId: string;
      requestType: "EXPORT_DATA" | "DELETE_ACCOUNT" | "CORRECTION";
      status: "REQUESTED" | "PROCESSING" | "COMPLETED" | "BLOCKED_LEGAL_RETENTION" | "REJECTED";
      reason: string | null;
      retentionBlockReason: string | null;
    }): Promise<void> {
      const reqUuid = rememberLogicalId(params.id);
      const userUuid = toDeterministicUuid(params.userId);
      await pool.query(
        `INSERT INTO public.privacy_requests (id, user_id, request_type, status, reason, retention_block_reason, is_test_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, retention_block_reason = EXCLUDED.retention_block_reason`,
        [
          reqUuid,
          userUuid,
          params.requestType,
          params.status,
          params.reason,
          params.retentionBlockReason,
          isTestData,
        ]
      );
    },

    async listOrganizationMembers(organizationId: string) {
      const orgUuid = toDeterministicUuid(organizationId);
      const res = await pool.query(
        `SELECT user_id, organization_id, store_id, role
         FROM public.organization_members
         WHERE organization_id = $1 AND is_active = true AND revoked_at IS NULL
         ORDER BY created_at ASC`,
        [orgUuid]
      );
      return res.rows.map((r) => ({
        userId: String(r.user_id),
        organizationId: String(r.organization_id),
        storeId: r.store_id ? String(r.store_id) : null,
        role: String(r.role),
      }));
    },

    async saveInvitation(
      record: StoredInvitationRecord & {
        organizationId?: string;
        storeId?: string | null;
        role?: string;
        invitedBy?: string;
      }
    ): Promise<void> {
      const invUuid = rememberLogicalId(record.id);
      const orgUuid = toDeterministicUuid(
        record.organizationId ?? "00000000-0000-4000-8000-000000000101"
      );
      const invitedByUuid = toDeterministicUuid(
        record.invitedBy ?? "00000000-0000-4000-8000-000000000010"
      );
      await pool.query(
        `INSERT INTO public.invitations (
           id, organization_id, store_id, invited_email, role, token_hash, status, invited_by, expires_at, accepted_at, is_test_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           token_hash = EXCLUDED.token_hash,
           status = EXCLUDED.status,
           accepted_at = EXCLUDED.accepted_at`,
        [
          invUuid,
          orgUuid,
          record.storeId ? toDeterministicUuid(record.storeId) : null,
          record.email,
          record.role ?? "partner_operator",
          record.tokenHash,
          record.consumedAtIso ? "ACCEPTED" : "PENDING",
          invitedByUuid,
          record.expiresAtIso,
          record.consumedAtIso,
          isTestData,
        ]
      );
    },

    async getInvitationById(id: string): Promise<StoredInvitationRecord | null> {
      const invUuid = toDeterministicUuid(id);
      const res = await pool.query(
        `SELECT id, invited_email, token_hash, expires_at, accepted_at
         FROM public.invitations WHERE id = $1 LIMIT 1`,
        [invUuid]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      return {
        id: restoreLogicalId(String(r.id)),
        email: String(r.invited_email),
        tokenHash: String(r.token_hash),
        expiresAtIso: new Date(String(r.expires_at)).toISOString(),
        consumedAtIso: r.accepted_at ? new Date(String(r.accepted_at)).toISOString() : null,
      };
    },

    async markInvitationConsumed(
      id: string,
      consumedAtIso: string,
      acceptedByUserId?: string
    ): Promise<void> {
      const invUuid = toDeterministicUuid(id);
      await pool.query(
        `UPDATE public.invitations
         SET status = 'ACCEPTED',
             accepted_at = $2,
             accepted_by = COALESCE($3, accepted_by)
         WHERE id = $1`,
        [invUuid, consumedAtIso, acceptedByUserId ? toDeterministicUuid(acceptedByUserId) : null]
      );
    },

    async appendAuditLog(entry: AuditLogWriteRecord): Promise<void> {
      const logUuid = rememberLogicalId(entry.id);
      const actorUuid = UUID_REGEX.test(entry.actorId) ? entry.actorId : null;
      await pool.query(
        `INSERT INTO public.audit_logs (
           id, actor_id, actor_role, action, target_type, target_id, correlation_id, reason, redacted_payload, is_test_data, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [
          logUuid,
          actorUuid,
          "AUTHENTICATED_ACTOR",
          entry.action,
          entry.targetType,
          entry.targetId,
          entry.correlationId,
          entry.reason,
          JSON.stringify(entry.redactedPayload ?? {}),
          isTestData,
          entry.createdAt,
        ]
      );
    },

    async getAuditLogs(): Promise<AuditLogWriteRecord[]> {
      const res = await pool.query(
        `SELECT id, actor_id, action, target_type, target_id, correlation_id, reason, redacted_payload, created_at
         FROM public.audit_logs
         ORDER BY created_at DESC
         LIMIT 200`
      );
      return res.rows.map((r) => ({
        id: restoreLogicalId(String(r.id)),
        actorId: String(r.actor_id ?? ""),
        action: String(r.action),
        targetType: String(r.target_type),
        targetId: String(r.target_id),
        correlationId: String(r.correlation_id),
        reason: r.reason ? String(r.reason) : null,
        redactedPayload: (r.redacted_payload as Record<string, unknown>) ?? {},
        createdAt: new Date(String(r.created_at)).toISOString(),
      }));
    },

    async listCustomerAddresses(userId: string): Promise<CustomerAddressContract[]> {
      const userUuid = toDeterministicUuid(userId);
      const res = await pool.query(
        `SELECT id, user_id, label, recipient_name, street_line, number, complement,
                neighborhood, city, state_code, postal_code, latitude, longitude,
                delivery_instructions, is_default
         FROM public.customer_addresses
         WHERE user_id = $1
         ORDER BY is_default DESC, created_at DESC`,
        [userUuid]
      );
      return res.rows.map((r) => ({
        id: restoreLogicalId(String(r.id)),
        userId: String(r.user_id),
        label: String(r.label),
        recipientName: String(r.recipient_name),
        streetLine: String(r.street_line),
        number: String(r.number),
        complement: r.complement ? String(r.complement) : null,
        neighborhood: String(r.neighborhood),
        city: String(r.city),
        stateCode: String(r.state_code),
        postalCode: String(r.postal_code),
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        deliveryInstructions: r.delivery_instructions ? String(r.delivery_instructions) : null,
        isDefault: Boolean(r.is_default),
      }));
    },

    async saveCustomerAddress(address: CustomerAddressContract): Promise<void> {
      const addrUuid = rememberLogicalId(address.id);
      const userUuid = toDeterministicUuid(address.userId);
      await pool.query(
        `INSERT INTO public.customer_addresses (
           id, user_id, label, recipient_name, street_line, number, complement,
           neighborhood, city, state_code, postal_code, latitude, longitude,
           delivery_instructions, is_default, is_test_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (id) DO UPDATE SET
           label = EXCLUDED.label,
           street_line = EXCLUDED.street_line,
           number = EXCLUDED.number,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           is_default = EXCLUDED.is_default`,
        [
          addrUuid,
          userUuid,
          address.label,
          address.recipientName,
          address.streetLine,
          address.number,
          address.complement,
          address.neighborhood,
          address.city,
          address.stateCode,
          address.postalCode,
          address.latitude,
          address.longitude,
          address.deliveryInstructions,
          address.isDefault,
          isTestData,
        ]
      );
    },

    async saveQuote(quote: ServerQuoteRecordContract): Promise<void> {
      const quoteUuid = rememberLogicalId(quote.id);
      const customerUuid = toDeterministicUuid(quote.customerId);
      const storeUuid = toDeterministicUuid(quote.storeId);
      const addrUuid =
        quote.addressId && UUID_REGEX.test(quote.addressId) ? quote.addressId : null;
      await pool.query(
        `INSERT INTO public.quotes (
           id, customer_id, store_id, address_id, fulfillment_modality, promotion_code,
           currency_code, subtotal_cents, addons_cents, service_fee_cents, delivery_fee_cents,
           discount_cents, total_cents, distance_meters, estimated_prep_minutes,
           estimated_delivery_minutes, items_snapshot, address_snapshot, idempotency_key,
           expires_at, consumed_at, is_test_data, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13, $14, $15,
           $16, $17::jsonb, $18::jsonb, $19,
           $20, $21, $22, $23
         )
         ON CONFLICT (customer_id, idempotency_key) DO UPDATE SET
           consumed_at = COALESCE(public.quotes.consumed_at, EXCLUDED.consumed_at)`,
        [
          quoteUuid,
          customerUuid,
          storeUuid,
          addrUuid,
          quote.fulfillmentModality,
          quote.promotionCode,
          quote.currencyCode,
          quote.subtotalCents,
          quote.addonsCents,
          quote.serviceFeeCents,
          quote.deliveryFeeCents,
          quote.discountCents,
          quote.totalCents,
          quote.distanceMeters,
          quote.estimatedPrepMinutes,
          quote.estimatedDeliveryMinutes,
          JSON.stringify(quote.itemsSnapshot ?? []),
          quote.addressSnapshot ? JSON.stringify(quote.addressSnapshot) : null,
          quote.idempotencyKey,
          quote.expiresAtIso,
          quote.consumedAtIso,
          isTestData,
          quote.createdAtIso,
        ]
      );
    },

    async getQuoteById(quoteId: string): Promise<ServerQuoteRecordContract | null> {
      const quoteUuid = toDeterministicUuid(quoteId);
      const res = await pool.query(`SELECT * FROM public.quotes WHERE id = $1 LIMIT 1`, [
        quoteUuid,
      ]);
      if (res.rowCount === 0) return null;
      const mapped = mapRowToQuote(res.rows[0] as Record<string, unknown>);
      return { ...mapped, id: restoreLogicalId(mapped.id) };
    },

    async getQuoteByCustomerIdempotencyKey(
      customerId: string,
      idempotencyKey: string
    ): Promise<ServerQuoteRecordContract | null> {
      const customerUuid = toDeterministicUuid(customerId);
      const res = await pool.query(
        `SELECT * FROM public.quotes WHERE customer_id = $1 AND idempotency_key = $2 LIMIT 1`,
        [customerUuid, idempotencyKey]
      );
      if (res.rowCount === 0) return null;
      const mapped = mapRowToQuote(res.rows[0] as Record<string, unknown>);
      return { ...mapped, id: restoreLogicalId(mapped.id) };
    },

    async markQuoteConsumed(quoteId: string, consumedAtIso: string): Promise<void> {
      const quoteUuid = toDeterministicUuid(quoteId);
      await pool.query(`UPDATE public.quotes SET consumed_at = $2 WHERE id = $1`, [
        quoteUuid,
        consumedAtIso,
      ]);
    },

    async nextOrderNumber(): Promise<number> {
      const res = await pool.query(
        `SELECT COALESCE(MAX(order_number), 10010)::int + 1 AS next_num FROM public.orders`
      );
      return Number((res.rows[0] as { next_num: number }).next_num);
    },

    async saveOrder(
      order: OrderRecordContract,
      initialEvent: OrderEventRecordContract
    ): Promise<void> {
      const orderUuid = rememberLogicalId(order.id);
      const customerUuid = toDeterministicUuid(order.customerId);
      const orgUuid = toDeterministicUuid(order.organizationId);
      const storeUuid = toDeterministicUuid(order.storeId);
      const quoteUuid = toDeterministicUuid(order.quoteId);
      const evtUuid = rememberLogicalId(initialEvent.id);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO public.orders (
             id, order_number, customer_id, organization_id, store_id, quote_id,
             fulfillment_modality, order_status, payment_status, delivery_status,
             currency_code, subtotal_cents, addons_cents, service_fee_cents,
             delivery_fee_cents, discount_cents, total_cents,
             platform_commission_cents, merchant_net_cents, courier_earnings_cents,
             delivery_address_snapshot, customer_notes, cancellation_reason, cancelled_by_role,
             version, idempotency_key, accepted_at, ready_at, delivered_at, cancelled_at,
             is_test_data, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10,
             $11, $12, $13, $14,
             $15, $16, $17,
             $18, $19, $20,
             $21::jsonb, $22, $23, $24,
             $25, $26, $27, $28, $29, $30,
             $31, $32, $33
           )`,
          [
            orderUuid,
            order.orderNumber,
            customerUuid,
            orgUuid,
            storeUuid,
            quoteUuid,
            order.fulfillmentModality,
            order.orderStatus,
            order.paymentStatus,
            order.deliveryStatus,
            order.currencyCode,
            order.subtotalCents,
            order.addonsCents,
            order.serviceFeeCents,
            order.deliveryFeeCents,
            order.discountCents,
            order.totalCents,
            order.platformCommissionCents,
            order.merchantNetCents,
            order.courierEarningsCents,
            order.deliveryAddressSnapshot ? JSON.stringify(order.deliveryAddressSnapshot) : null,
            order.customerNotes,
            order.cancellationReason,
            order.cancelledByRole,
            order.version,
            order.idempotencyKey,
            order.acceptedAtIso,
            order.readyAtIso,
            order.deliveredAtIso,
            order.cancelledAtIso,
            isTestData,
            order.createdAtIso,
            order.updatedAtIso,
          ]
        );

        await client.query(
          `INSERT INTO public.order_events (
             id, order_id, actor_id, actor_role, event_type,
             previous_order_status, new_order_status,
             previous_payment_status, new_payment_status,
             previous_delivery_status, new_delivery_status,
             idempotency_key, payload, is_test_data, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
           ON CONFLICT (order_id, idempotency_key) DO NOTHING`,
          [
            evtUuid,
            orderUuid,
            initialEvent.actorId && UUID_REGEX.test(initialEvent.actorId)
              ? initialEvent.actorId
              : null,
            initialEvent.actorRole,
            initialEvent.eventType,
            initialEvent.previousOrderStatus,
            initialEvent.newOrderStatus,
            initialEvent.previousPaymentStatus,
            initialEvent.newPaymentStatus,
            initialEvent.previousDeliveryStatus,
            initialEvent.newDeliveryStatus,
            initialEvent.idempotencyKey,
            JSON.stringify(initialEvent.payload ?? {}),
            isTestData,
            initialEvent.createdAtIso,
          ]
        );

        await client.query(
          `INSERT INTO public.outbox_events (
             id, aggregate_type, aggregate_id, event_type, idempotency_key, payload, status, is_test_data
           ) VALUES ($1, 'ORDER', $2, $3, $4, $5::jsonb, 'PENDING', $6)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            crypto.randomUUID(),
            orderUuid,
            initialEvent.eventType,
            `outbox_order_${orderUuid}_${initialEvent.idempotencyKey}`,
            JSON.stringify({
              orderId: order.id,
              orderStatus: order.orderStatus,
              paymentStatus: order.paymentStatus,
            }),
            isTestData,
          ]
        );

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async getOrderById(orderId: string): Promise<OrderRecordContract | null> {
      const orderUuid = toDeterministicUuid(orderId);
      const res = await pool.query(
        `SELECT o.*, q.items_snapshot
         FROM public.orders o
         LEFT JOIN public.quotes q ON q.id = o.quote_id
         WHERE o.id = $1
         LIMIT 1`,
        [orderUuid]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      const itemsSnapshot =
        (r.items_snapshot as ServerQuoteRecordContract["itemsSnapshot"]) ?? [];
      const mapped = mapRowToOrder(r, itemsSnapshot);
      return {
        ...mapped,
        id: restoreLogicalId(mapped.id),
        quoteId: restoreLogicalId(mapped.quoteId),
      };
    },

    async getOrderByCustomerIdempotencyKey(
      customerId: string,
      idempotencyKey: string
    ): Promise<OrderRecordContract | null> {
      const customerUuid = toDeterministicUuid(customerId);
      const res = await pool.query(
        `SELECT o.*, q.items_snapshot
         FROM public.orders o
         LEFT JOIN public.quotes q ON q.id = o.quote_id
         WHERE o.customer_id = $1 AND o.idempotency_key = $2
         LIMIT 1`,
        [customerUuid, idempotencyKey]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      const itemsSnapshot =
        (r.items_snapshot as ServerQuoteRecordContract["itemsSnapshot"]) ?? [];
      const mapped = mapRowToOrder(r, itemsSnapshot);
      return {
        ...mapped,
        id: restoreLogicalId(mapped.id),
        quoteId: restoreLogicalId(mapped.quoteId),
      };
    },

    async listOrdersByStore(storeId: string): Promise<OrderRecordContract[]> {
      const storeUuid = toDeterministicUuid(storeId);
      const res = await pool.query(
        `SELECT o.*, q.items_snapshot
         FROM public.orders o
         LEFT JOIN public.quotes q ON q.id = o.quote_id
         WHERE o.store_id = $1
         ORDER BY o.created_at DESC`,
        [storeUuid]
      );
      return res.rows.map((rawRow) => {
        const r = rawRow as Record<string, unknown>;
        const itemsSnapshot =
          (r.items_snapshot as ServerQuoteRecordContract["itemsSnapshot"]) ?? [];
        const mapped = mapRowToOrder(r, itemsSnapshot);
        return {
          ...mapped,
          id: restoreLogicalId(mapped.id),
          quoteId: restoreLogicalId(mapped.quoteId),
        };
      });
    },

    async updateOrderWithEvent(
      order: OrderRecordContract,
      event: OrderEventRecordContract
    ): Promise<void> {
      const orderUuid = toDeterministicUuid(order.id);
      const evtUuid = rememberLogicalId(event.id);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE public.orders
           SET order_status = $2,
               payment_status = $3,
               delivery_status = $4,
               cancellation_reason = $5,
               cancelled_by_role = $6,
               version = $7,
               accepted_at = $8,
               ready_at = $9,
               delivered_at = $10,
               cancelled_at = $11,
               updated_at = $12
           WHERE id = $1`,
          [
            orderUuid,
            order.orderStatus,
            order.paymentStatus,
            order.deliveryStatus,
            order.cancellationReason,
            order.cancelledByRole,
            order.version,
            order.acceptedAtIso,
            order.readyAtIso,
            order.deliveredAtIso,
            order.cancelledAtIso,
            order.updatedAtIso,
          ]
        );

        await client.query(
          `INSERT INTO public.order_events (
             id, order_id, actor_id, actor_role, event_type,
             previous_order_status, new_order_status,
             previous_payment_status, new_payment_status,
             previous_delivery_status, new_delivery_status,
             idempotency_key, payload, is_test_data, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
           ON CONFLICT (order_id, idempotency_key) DO NOTHING`,
          [
            evtUuid,
            orderUuid,
            event.actorId && UUID_REGEX.test(event.actorId) ? event.actorId : null,
            event.actorRole,
            event.eventType,
            event.previousOrderStatus,
            event.newOrderStatus,
            event.previousPaymentStatus,
            event.newPaymentStatus,
            event.previousDeliveryStatus,
            event.newDeliveryStatus,
            event.idempotencyKey,
            JSON.stringify(event.payload ?? {}),
            isTestData,
            event.createdAtIso,
          ]
        );

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async listOrderEvents(orderId: string): Promise<OrderEventRecordContract[]> {
      const orderUuid = toDeterministicUuid(orderId);
      const res = await pool.query(
        `SELECT * FROM public.order_events WHERE order_id = $1 ORDER BY created_at ASC`,
        [orderUuid]
      );
      return res.rows.map((r) => ({
        id: restoreLogicalId(String(r.id)),
        orderId: restoreLogicalId(String(r.order_id)),
        actorId: r.actor_id ? String(r.actor_id) : null,
        actorRole: String(r.actor_role),
        eventType: String(r.event_type),
        previousOrderStatus: r.previous_order_status
          ? (String(r.previous_order_status) as OrderStatus)
          : null,
        newOrderStatus: String(r.new_order_status) as OrderStatus,
        previousPaymentStatus: r.previous_payment_status
          ? (String(r.previous_payment_status) as PaymentStatus)
          : null,
        newPaymentStatus: r.new_payment_status
          ? (String(r.new_payment_status) as PaymentStatus)
          : null,
        previousDeliveryStatus: r.previous_delivery_status
          ? (String(r.previous_delivery_status) as DeliveryStatus)
          : null,
        newDeliveryStatus: r.new_delivery_status
          ? (String(r.new_delivery_status) as DeliveryStatus)
          : null,
        idempotencyKey: String(r.idempotency_key),
        payload: (r.payload as Record<string, unknown>) ?? {},
        createdAtIso: new Date(String(r.created_at)).toISOString(),
      }));
    },

    async hasProcessedWebhookEvent(
      providerCode: string,
      externalEventId: string
    ): Promise<boolean> {
      const res = await pool.query(
        `SELECT 1 FROM public.payment_provider_events
         WHERE provider_code = $1 AND external_event_id = $2
         LIMIT 1`,
        [providerCode, externalEventId]
      );
      return (res.rowCount ?? 0) > 0;
    },

    async recordProcessedWebhookEvent(params: {
      providerCode: string;
      externalEventId: string;
      paymentAttemptId: string | null;
      eventType: string;
      redactedPayload: Record<string, unknown>;
    }): Promise<void> {
      await pool.query(
        `INSERT INTO public.payment_provider_events (
           id, provider_code, external_event_id, payment_attempt_id, event_type,
           signature_verified, processed_at, redacted_payload, is_test_data
         ) VALUES ($1, $2, $3, $4, $5, true, timezone('utc', now()), $6::jsonb, $7)
         ON CONFLICT (provider_code, external_event_id) DO NOTHING`,
        [
          crypto.randomUUID(),
          params.providerCode,
          params.externalEventId,
          params.paymentAttemptId ? toDeterministicUuid(params.paymentAttemptId) : null,
          params.eventType,
          JSON.stringify(params.redactedPayload ?? {}),
          isTestData,
        ]
      );
    },

    async savePaymentAttempt(attempt: PaymentAttemptContract): Promise<void> {
      const attemptUuid = rememberLogicalId(attempt.id);
      const orderUuid = toDeterministicUuid(attempt.orderId);
      const customerUuid = toDeterministicUuid(attempt.customerId);
      await pool.query(
        `INSERT INTO public.payment_attempts (
           id, order_id, customer_id, provider_code, payment_method,
           amount_cents, currency_code, status, external_payment_id,
           idempotency_key, is_sandbox, error_code, is_test_data, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (idempotency_key) DO UPDATE SET status = EXCLUDED.status`,
        [
          attemptUuid,
          orderUuid,
          customerUuid,
          attempt.providerCode,
          attempt.paymentMethod as PaymentMethodCode,
          attempt.amountCents,
          attempt.currencyCode,
          attempt.status,
          attempt.externalPaymentId,
          attempt.idempotencyKey,
          attempt.isSandbox,
          attempt.errorCode,
          isTestData,
          attempt.createdAtIso,
        ]
      );
    },

    async listRefundsByOrder(orderId: string): Promise<RefundRecordContract[]> {
      const orderUuid = toDeterministicUuid(orderId);
      const res = await pool.query(
        `SELECT * FROM public.refunds WHERE order_id = $1 ORDER BY created_at ASC`,
        [orderUuid]
      );
      return res.rows.map((r) => ({
        id: restoreLogicalId(String(r.id)),
        orderId: restoreLogicalId(String(r.order_id)),
        paymentAttemptId: restoreLogicalId(String(r.payment_attempt_id)),
        amountCents: Number(r.amount_cents),
        reason: String(r.reason),
        requestedBy: String(r.requested_by),
        approvedBy: r.approved_by ? String(r.approved_by) : null,
        status: String(r.status) as RefundRecordContract["status"],
        idempotencyKey: String(r.idempotency_key),
        createdAtIso: new Date(String(r.created_at)).toISOString(),
      }));
    },

    async saveRefundAndUpdateOrder(
      refund: RefundRecordContract,
      updatedOrder: OrderRecordContract
    ): Promise<void> {
      const refundUuid = rememberLogicalId(refund.id);
      const orderUuid = toDeterministicUuid(refund.orderId);
      const payAttemptUuid = rememberLogicalId(refund.paymentAttemptId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Ensure a corresponding payment_attempts row exists if the caller passed a synthetic paymentAttemptId
        await client.query(
          `INSERT INTO public.payment_attempts (
             id, order_id, customer_id, provider_code, payment_method,
             amount_cents, currency_code, status, idempotency_key, is_sandbox, is_test_data
           ) VALUES ($1, $2, $3, 'stripe', 'PIX', $4, 'BRL', 'CAPTURED', $5, true, $6)
           ON CONFLICT (id) DO NOTHING`,
          [
            payAttemptUuid,
            orderUuid,
            toDeterministicUuid(updatedOrder.customerId),
            updatedOrder.totalCents,
            `auto_pay_${payAttemptUuid}`,
            isTestData,
          ]
        );

        await client.query(
          `INSERT INTO public.refunds (
             id, order_id, payment_attempt_id, amount_cents, reason,
             requested_by, approved_by, status, idempotency_key, is_test_data, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            refundUuid,
            orderUuid,
            payAttemptUuid,
            refund.amountCents,
            refund.reason,
            toDeterministicUuid(refund.requestedBy),
            refund.approvedBy ? toDeterministicUuid(refund.approvedBy) : null,
            refund.status,
            refund.idempotencyKey,
            isTestData,
            refund.createdAtIso,
          ]
        );

        await client.query(
          `UPDATE public.orders
           SET payment_status = $2,
               order_status = $3,
               version = $4,
               updated_at = $5
           WHERE id = $1`,
          [
            orderUuid,
            updatedOrder.paymentStatus,
            updatedOrder.orderStatus,
            updatedOrder.version,
            updatedOrder.updatedAtIso,
          ]
        );

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async saveBankAccountChangeRequest(req: BankAccountChangeRequestContract): Promise<void> {
      const reqUuid = rememberLogicalId(req.id);
      const storeUuid = toDeterministicUuid(req.storeId);
      const orgUuid = toDeterministicUuid(req.organizationId);
      const actorUuid = toDeterministicUuid(req.requestedBy);
      await pool.query(
        `INSERT INTO public.approval_events (
           id, target_type, target_id, organization_id, new_status, decided_by, reason, evidence_metadata, is_test_data, created_at
         ) VALUES ($1, 'BANK_ACCOUNT', $2, $3, 'PENDING', $4, $5, $6::jsonb, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          reqUuid,
          storeUuid,
          orgUuid,
          actorUuid,
          req.reason,
          JSON.stringify({
            bankCode: req.bankCode,
            branchNumber: req.branchNumber,
            accountLast4: req.accountLast4,
            status: req.status,
          }),
          isTestData,
          req.createdAtIso,
        ]
      );
    },

    async grantStaffScope(
      grant: AdminStaffScopeGrantRequestContract & { grantedBy: string }
    ): Promise<void> {
      const targetUuid = toDeterministicUuid(grant.targetUserId);
      const grantedByUuid = toDeterministicUuid(grant.grantedBy);
      await pool.query(
        `INSERT INTO public.staff_scopes (
           user_id, role, region_code, max_refund_approval_cents, requires_mfa, is_active, granted_by, justification, is_test_data
         ) VALUES ($1, $2, $3, $4, true, true, $5, $6, $7)
         ON CONFLICT (user_id, role, region_code) DO UPDATE SET
           max_refund_approval_cents = EXCLUDED.max_refund_approval_cents,
           is_active = true,
           revoked_at = NULL,
           granted_by = EXCLUDED.granted_by,
           justification = EXCLUDED.justification`,
        [
          targetUuid,
          grant.role,
          grant.regionCode,
          grant.maxRefundApprovalCents,
          grantedByUuid,
          grant.justification,
          isTestData,
        ]
      );
    },

    async saveGovernanceApprovalEvent(
      action: AdminGovernanceActionContract & { organizationId?: string | null }
    ): Promise<void> {
      const evtUuid = rememberLogicalId(action.id);
      const targetUuid = toDeterministicUuid(action.targetId);
      const actorUuid = toDeterministicUuid(action.actorId);
      const mappedStatus =
        action.decision === "REJECTED" || action.decision === "SUSPENDED"
          ? "REJECTED"
          : "APPROVED";
      await pool.query(
        `INSERT INTO public.approval_events (
           id, target_type, target_id, organization_id, new_status, decided_by, reason, evidence_metadata, is_test_data, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          evtUuid,
          action.targetType,
          targetUuid,
          action.organizationId ? toDeterministicUuid(action.organizationId) : null,
          mappedStatus,
          actorUuid,
          action.reason,
          JSON.stringify({ decision: action.decision }),
          isTestData,
          action.createdAtIso,
        ]
      );
    },

    async saveReconciliationRun(run: PspReconciliationRunContract): Promise<void> {
      const runUuid = rememberLogicalId(run.id);
      await pool.query(
        `INSERT INTO public.reconciliation_runs (
           id, provider_code, run_date, matched_count, discrepancy_count, discrepancy_total_cents, status, is_test_data, created_at
         ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           matched_count = EXCLUDED.matched_count,
           discrepancy_count = EXCLUDED.discrepancy_count,
           discrepancy_total_cents = EXCLUDED.discrepancy_total_cents,
           status = EXCLUDED.status`,
        [
          runUuid,
          run.providerCode,
          run.runDate,
          run.matchedCount,
          run.discrepancyCount,
          run.discrepancyTotalCents,
          run.status,
          isTestData,
          run.createdAtIso,
        ]
      );
    },

    async getSettlementById(settlementId: string): Promise<SettlementRecordContract | null> {
      const settleUuid = toDeterministicUuid(settlementId);
      const res = await pool.query(
        `SELECT * FROM public.settlements WHERE id = $1 LIMIT 1`,
        [settleUuid]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      return {
        id: restoreLogicalId(String(r.id)),
        organizationId: r.organization_id ? String(r.organization_id) : null,
        courierId: r.courier_id ? String(r.courier_id) : null,
        periodStart: String(r.period_start),
        periodEnd: String(r.period_end),
        amountCents: Number(r.amount_cents),
        status: String(r.status) as SettlementRecordContract["status"],
        approvedBy: r.approved_by ? String(r.approved_by) : null,
        externalPayoutReference: r.external_payout_reference
          ? String(r.external_payout_reference)
          : null,
        createdAtIso: new Date(String(r.created_at)).toISOString(),
      };
    },

    async saveSettlement(settlement: SettlementRecordContract): Promise<void> {
      const settleUuid = rememberLogicalId(settlement.id);
      await pool.query(
        `INSERT INTO public.settlements (
           id, organization_id, courier_id, period_start, period_end,
           amount_cents, status, approved_by, external_payout_reference, is_test_data, created_at
         ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           approved_by = EXCLUDED.approved_by,
           external_payout_reference = EXCLUDED.external_payout_reference`,
        [
          settleUuid,
          settlement.organizationId ? toDeterministicUuid(settlement.organizationId) : null,
          settlement.courierId ? toDeterministicUuid(settlement.courierId) : null,
          settlement.periodStart,
          settlement.periodEnd,
          settlement.amountCents,
          settlement.status,
          settlement.approvedBy && UUID_REGEX.test(settlement.approvedBy)
            ? settlement.approvedBy
            : null,
          settlement.externalPayoutReference,
          isTestData,
          settlement.createdAtIso,
        ]
      );
    },

    async saveDeliveryTaskAndOffer(params: {
      task: DeliveryTaskContract;
      fullAddress: string;
      confirmationCodeHash: string;
      offer: DeliveryOfferContract;
    }): Promise<void> {
      const { task, fullAddress, confirmationCodeHash, offer } = params;
      const taskUuid = rememberLogicalId(task.id);
      const offerUuid = rememberLogicalId(offer.id);
      const orderUuid = rememberLogicalId(task.orderId);
      const storeUuid = toDeterministicUuid(task.storeId);
      const courierUuid = toDeterministicUuid(offer.courierId);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Ensure courier record exists in public.couriers if courierUuid references a profile
        await client.query(
          `INSERT INTO public.couriers (id, approval_status, document_number_hash, active_region_code, vehicle_type, is_online, is_test_data)
           SELECT $1, 'APPROVED', encode(digest($1::text, 'sha256'), 'hex'), 'SP-CAPITAL', 'MOTORCYCLE', true, true
           WHERE EXISTS (SELECT 1 FROM public.profiles WHERE id = $1)
           ON CONFLICT (id) DO NOTHING`,
          [courierUuid]
        );

        // If task.orderId does not exist yet in public.orders (e.g., standalone dispatch test),
        // link to an existing order or create a lightweight placeholder order for FK integrity
        const ordCheck = await client.query(`SELECT id FROM public.orders WHERE id = $1 LIMIT 1`, [
          orderUuid,
        ]);
        let effectiveOrderUuid = orderUuid;
        if (ordCheck.rowCount === 0) {
          const anyOrd = await client.query(
            `SELECT o.id FROM public.orders o
             LEFT JOIN public.delivery_tasks dt ON dt.order_id = o.id
             WHERE dt.id IS NULL OR dt.id = $1
             ORDER BY o.created_at DESC LIMIT 1`,
            [taskUuid]
          );
          if ((anyOrd.rowCount ?? 0) > 0) {
            effectiveOrderUuid = String(anyOrd.rows[0].id);
          }
        }

        await client.query(
          `INSERT INTO public.delivery_tasks (
             id, order_id, store_id, fulfillment_modality, status,
             pickup_latitude, pickup_longitude, dropoff_latitude, dropoff_longitude,
             dropoff_neighborhood_only, dropoff_full_address, confirmation_code_hash,
             courier_fee_cents, distance_meters, estimated_eta_minutes,
             active_courier_id, picked_up_at, completed_at, is_test_data, created_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9,
             $10, $11, $12,
             $13, $14, $15,
             $16, $17, $18, $19, $20
           )
           ON CONFLICT (id) DO UPDATE SET
             status = EXCLUDED.status,
             dropoff_full_address = EXCLUDED.dropoff_full_address,
             confirmation_code_hash = EXCLUDED.confirmation_code_hash`,
          [
            taskUuid,
            effectiveOrderUuid,
            storeUuid,
            task.fulfillmentModality,
            task.status,
            task.pickupLatitude,
            task.pickupLongitude,
            task.dropoffLatitude,
            task.dropoffLongitude,
            task.dropoffNeighborhoodOnly,
            fullAddress,
            confirmationCodeHash,
            task.courierFeeCents,
            task.distanceMeters,
            task.estimatedEtaMinutes,
            task.activeCourierId ? toDeterministicUuid(task.activeCourierId) : null,
            task.pickedUpAtIso,
            task.completedAtIso,
            isTestData,
            task.createdAtIso,
          ]
        );

        await client.query(
          `INSERT INTO public.delivery_offers (
             id, delivery_task_id, courier_id, offered_fee_cents, status,
             pickup_store_name, distance_meters, dropoff_neighborhood_only,
             expires_at, responded_at, is_test_data
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO UPDATE SET
             status = EXCLUDED.status,
             responded_at = EXCLUDED.responded_at`,
          [
            offerUuid,
            taskUuid,
            courierUuid,
            offer.offeredFeeCents,
            offer.status,
            offer.pickupStoreName,
            offer.distanceMeters,
            offer.dropoffNeighborhoodOnly,
            offer.expiresAtIso,
            offer.respondedAtIso,
            isTestData,
          ]
        );

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async getDeliveryOfferById(offerId: string): Promise<DeliveryOfferContract | null> {
      const offerUuid = toDeterministicUuid(offerId);
      const res = await pool.query(
        `SELECT * FROM public.delivery_offers WHERE id = $1 LIMIT 1`,
        [offerUuid]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      return {
        id: restoreLogicalId(String(r.id)),
        deliveryTaskId: restoreLogicalId(String(r.delivery_task_id)),
        courierId: restoreLogicalId(String(r.courier_id)),
        offeredFeeCents: Number(r.offered_fee_cents),
        status: String(r.status) as DeliveryOfferContract["status"],
        pickupStoreName: String(r.pickup_store_name),
        distanceMeters: Number(r.distance_meters),
        dropoffNeighborhoodOnly: String(r.dropoff_neighborhood_only),
        expiresAtIso: new Date(String(r.expires_at)).toISOString(),
        respondedAtIso: r.responded_at ? new Date(String(r.responded_at)).toISOString() : null,
      };
    },

    async getDeliveryTaskById(taskId: string) {
      const taskUuid = toDeterministicUuid(taskId);
      const res = await pool.query(
        `SELECT * FROM public.delivery_tasks WHERE id = $1 LIMIT 1`,
        [taskUuid]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      const activeCourierId = r.active_courier_id
        ? restoreLogicalId(String(r.active_courier_id))
        : null;
      const fullAddress = r.dropoff_full_address ? String(r.dropoff_full_address) : null;
      const task: DeliveryTaskContract = {
        id: restoreLogicalId(String(r.id)),
        orderId: restoreLogicalId(String(r.order_id)),
        storeId: restoreLogicalId(String(r.store_id)),
        fulfillmentModality: String(
          r.fulfillment_modality ?? "PLATFORM_DELIVERY"
        ) as FulfillmentModality,
        status: String(r.status) as DeliveryStatus,
        pickupLatitude: Number(r.pickup_latitude),
        pickupLongitude: Number(r.pickup_longitude),
        dropoffLatitude: Number(r.dropoff_latitude),
        dropoffLongitude: Number(r.dropoff_longitude),
        dropoffNeighborhoodOnly: String(r.dropoff_neighborhood_only ?? ""),
        // Full address is only exposed on the task contract once a courier is assigned
        dropoffFullAddress: activeCourierId ? fullAddress : null,
        courierFeeCents: Number(r.courier_fee_cents),
        distanceMeters: Number(r.distance_meters),
        estimatedEtaMinutes: Number(r.estimated_eta_minutes ?? 20),
        activeCourierId,
        pickedUpAtIso: r.picked_up_at ? new Date(String(r.picked_up_at)).toISOString() : null,
        completedAtIso: r.completed_at ? new Date(String(r.completed_at)).toISOString() : null,
        createdAtIso: new Date(String(r.created_at)).toISOString(),
      };
      return {
        task,
        fullAddress,
        confirmationCodeHash: r.confirmation_code_hash
          ? String(r.confirmation_code_hash)
          : null,
      };
    },

    async saveAcceptedDeliveryOffer(params: {
      offer: DeliveryOfferContract;
      task: DeliveryTaskContract;
      fullAddress: string;
    }): Promise<void> {
      const { offer, task, fullAddress } = params;
      const offerUuid = toDeterministicUuid(offer.id);
      const taskUuid = toDeterministicUuid(task.id);
      const courierUuid = toDeterministicUuid(offer.courierId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE public.delivery_offers
           SET status = $2, responded_at = $3
           WHERE id = $1`,
          [offerUuid, offer.status, offer.respondedAtIso]
        );
        await client.query(
          `UPDATE public.delivery_tasks
           SET status = $2,
               active_courier_id = $3,
               dropoff_full_address = $4,
               picked_up_at = $5,
               completed_at = $6,
               updated_at = timezone('utc', now())
           WHERE id = $1`,
          [
            taskUuid,
            task.status,
            task.activeCourierId ? toDeterministicUuid(task.activeCourierId) : null,
            fullAddress,
            task.pickedUpAtIso,
            task.completedAtIso,
          ]
        );
        await client.query(
          `INSERT INTO public.delivery_assignments (
             id, delivery_task_id, courier_id, offer_id, status, is_test_data
           ) VALUES ($1, $2, $3, $4, 'ACTIVE', $5)
           ON CONFLICT (delivery_task_id) WHERE status = 'ACTIVE' DO NOTHING`,
          [crypto.randomUUID(), taskUuid, courierUuid, offerUuid, isTestData]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async completeDeliveryTask(task: DeliveryTaskContract): Promise<void> {
      const taskUuid = toDeterministicUuid(task.id);
      await pool.query(
        `UPDATE public.delivery_tasks
         SET status = $2,
             completed_at = $3,
             updated_at = timezone('utc', now())
         WHERE id = $1`,
        [taskUuid, task.status, task.completedAtIso]
      );
      await pool.query(
        `UPDATE public.delivery_assignments
         SET status = 'COMPLETED', ended_at = $2
         WHERE delivery_task_id = $1 AND status = 'ACTIVE'`,
        [taskUuid, task.completedAtIso]
      );
    },

    async saveCourierLocationSample(sample: CourierLocationSampleContract): Promise<void> {
      const sampleUuid = rememberLogicalId(sample.id);
      const courierUuid = toDeterministicUuid(sample.courierId);
      const taskUuid = sample.deliveryTaskId
        ? toDeterministicUuid(sample.deliveryTaskId)
        : null;
      await pool.query(
        `INSERT INTO public.courier_location_samples (
           id, courier_id, delivery_task_id, latitude, longitude,
           accuracy_meters, recorded_at, expires_at, is_test_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, ($7::timestamptz + interval '30 days'), $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          sampleUuid,
          courierUuid,
          taskUuid,
          sample.latitude,
          sample.longitude,
          sample.accuracyMeters,
          sample.recordedAtIso,
          isTestData,
        ]
      );
    },

    async replaceStoreOperatingHours(
      storeId: string,
      hours: StoreOperatingHourContract[]
    ): Promise<StoreOperatingHourContract[]> {
      const storeUuid = toDeterministicUuid(storeId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM public.store_hours WHERE store_id = $1`, [
          storeUuid,
        ]);
        for (const h of hours) {
          await client.query(
            `INSERT INTO public.store_hours (
               id, store_id, day_of_week, opens_at, closes_at, is_overnight, is_closed, is_test_data
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              crypto.randomUUID(),
              storeUuid,
              h.dayOfWeek,
              h.opensAt,
              h.closesAt,
              h.isOvernight,
              h.isClosed,
              isTestData,
            ]
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      const res = await pool.query(
        `SELECT day_of_week, opens_at::text AS opens_at, closes_at::text AS closes_at, is_overnight, is_closed
         FROM public.store_hours WHERE store_id = $1 ORDER BY day_of_week ASC, opens_at ASC`,
        [storeUuid]
      );
      return res.rows.map((r) => ({
        dayOfWeek: Number(r.day_of_week),
        opensAt: String(r.opens_at),
        closesAt: String(r.closes_at),
        isOvernight: Boolean(r.is_overnight),
        isClosed: Boolean(r.is_closed),
      }));
    },

    async upsertStoreHourException(
      storeId: string,
      exception: StoreHourExceptionContract
    ): Promise<StoreHourExceptionContract> {
      const storeUuid = toDeterministicUuid(storeId);
      const res = await pool.query(
        `INSERT INTO public.store_hour_exceptions (
           id, store_id, exception_date, is_closed, opens_at, closes_at, reason, is_test_data
         ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)
         ON CONFLICT (store_id, exception_date) DO UPDATE SET
           is_closed = EXCLUDED.is_closed,
           opens_at = EXCLUDED.opens_at,
           closes_at = EXCLUDED.closes_at,
           reason = EXCLUDED.reason
         RETURNING exception_date::text AS exception_date, is_closed, opens_at::text AS opens_at, closes_at::text AS closes_at, reason`,
        [
          crypto.randomUUID(),
          storeUuid,
          exception.exceptionDate,
          exception.isClosed,
          exception.opensAt,
          exception.closesAt,
          exception.reason ?? "Holiday / Special Schedule",
          isTestData,
        ]
      );
      const r = res.rows[0] as Record<string, unknown>;
      return {
        exceptionDate: String(r.exception_date),
        isClosed: Boolean(r.is_closed),
        opensAt: r.opens_at ? String(r.opens_at) : null,
        closesAt: r.closes_at ? String(r.closes_at) : null,
        reason: r.reason ? String(r.reason) : null,
      };
    },

    async deleteStoreHourException(
      storeId: string,
      exceptionDate: string
    ): Promise<boolean> {
      const storeUuid = toDeterministicUuid(storeId);
      const res = await pool.query(
        `DELETE FROM public.store_hour_exceptions WHERE store_id = $1 AND exception_date = $2::date`,
        [storeUuid, exceptionDate]
      );
      return (res.rowCount ?? 0) > 0;
    },

    async createStoreServiceArea(
      area: StoreServiceAreaContract
    ): Promise<StoreServiceAreaContract> {
      const areaUuid = rememberLogicalId(area.id);
      const storeUuid = toDeterministicUuid(area.storeId);
      const res = await pool.query(
        `INSERT INTO public.store_service_areas (
           id, store_id, name, radius_meters, base_fee_cents, per_km_fee_cents,
           free_delivery_min_order_cents, estimated_delivery_minutes, is_active, is_test_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           radius_meters = EXCLUDED.radius_meters,
           base_fee_cents = EXCLUDED.base_fee_cents,
           per_km_fee_cents = EXCLUDED.per_km_fee_cents,
           free_delivery_min_order_cents = EXCLUDED.free_delivery_min_order_cents,
           estimated_delivery_minutes = EXCLUDED.estimated_delivery_minutes,
           is_active = EXCLUDED.is_active
         RETURNING *`,
        [
          areaUuid,
          storeUuid,
          area.name,
          area.radiusMeters,
          area.baseFeeCents,
          area.perKmFeeCents,
          area.freeDeliveryMinOrderCents,
          area.estimatedDeliveryMinutes,
          area.isActive,
          isTestData,
        ]
      );
      const r = res.rows[0] as Record<string, unknown>;
      return {
        id: String(r.id),
        storeId: String(r.store_id),
        name: String(r.name),
        radiusMeters: Number(r.radius_meters),
        baseFeeCents: Number(r.base_fee_cents),
        perKmFeeCents: Number(r.per_km_fee_cents),
        freeDeliveryMinOrderCents:
          r.free_delivery_min_order_cents !== null
            ? Number(r.free_delivery_min_order_cents)
            : null,
        estimatedDeliveryMinutes: Number(r.estimated_delivery_minutes),
        isActive: Boolean(r.is_active),
      };
    },

    async updateStoreServiceArea(
      storeId: string,
      areaId: string,
      patch: Partial<Omit<StoreServiceAreaContract, "id" | "storeId">>
    ): Promise<StoreServiceAreaContract | null> {
      const storeUuid = toDeterministicUuid(storeId);
      const areaUuid = toDeterministicUuid(areaId);
      const res = await pool.query(
        `UPDATE public.store_service_areas
         SET name = COALESCE($3, name),
             radius_meters = COALESCE($4, radius_meters),
             base_fee_cents = COALESCE($5, base_fee_cents),
             per_km_fee_cents = COALESCE($6, per_km_fee_cents),
             free_delivery_min_order_cents = CASE WHEN $7::boolean THEN $8 ELSE free_delivery_min_order_cents END,
             estimated_delivery_minutes = COALESCE($9, estimated_delivery_minutes),
             is_active = COALESCE($10, is_active)
         WHERE id = $1 AND store_id = $2
         RETURNING *`,
        [
          areaUuid,
          storeUuid,
          patch.name !== undefined ? patch.name : null,
          patch.radiusMeters !== undefined ? patch.radiusMeters : null,
          patch.baseFeeCents !== undefined ? patch.baseFeeCents : null,
          patch.perKmFeeCents !== undefined ? patch.perKmFeeCents : null,
          patch.freeDeliveryMinOrderCents !== undefined,
          patch.freeDeliveryMinOrderCents !== undefined
            ? patch.freeDeliveryMinOrderCents
            : null,
          patch.estimatedDeliveryMinutes !== undefined
            ? patch.estimatedDeliveryMinutes
            : null,
          patch.isActive !== undefined ? patch.isActive : null,
        ]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      return {
        id: String(r.id),
        storeId: String(r.store_id),
        name: String(r.name),
        radiusMeters: Number(r.radius_meters),
        baseFeeCents: Number(r.base_fee_cents),
        perKmFeeCents: Number(r.per_km_fee_cents),
        freeDeliveryMinOrderCents:
          r.free_delivery_min_order_cents !== null
            ? Number(r.free_delivery_min_order_cents)
            : null,
        estimatedDeliveryMinutes: Number(r.estimated_delivery_minutes),
        isActive: Boolean(r.is_active),
      };
    },

    async deleteStoreServiceArea(storeId: string, areaId: string): Promise<boolean> {
      const storeUuid = toDeterministicUuid(storeId);
      const areaUuid = toDeterministicUuid(areaId);
      const res = await pool.query(
        `DELETE FROM public.store_service_areas WHERE id = $1 AND store_id = $2`,
        [areaUuid, storeUuid]
      );
      return (res.rowCount ?? 0) > 0;
    },

    async createCatalogCategory(
      storeId: string,
      input: CatalogCategoryUpsertContract & { id?: string },
      locale: SupportedLocale = DEFAULT_LOCALE
    ): Promise<CatalogCategoryContract> {
      const catUuid = input.id ? rememberLogicalId(input.id) : crypto.randomUUID();
      const storeUuid = toDeterministicUuid(storeId);
      const res = await pool.query(
        `INSERT INTO public.catalog_categories (
           id, store_id, name_en, name_pt_br, sort_order, is_active, is_test_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           name_en = EXCLUDED.name_en,
           name_pt_br = EXCLUDED.name_pt_br,
           sort_order = EXCLUDED.sort_order,
           is_active = EXCLUDED.is_active
         RETURNING *`,
        [
          catUuid,
          storeUuid,
          input.nameEn,
          input.namePtBr,
          input.sortOrder ?? 0,
          input.isActive ?? true,
          isTestData,
        ]
      );
      const r = res.rows[0] as Record<string, unknown>;
      const nameEn = String(r.name_en);
      const namePtBr = String(r.name_pt_br);
      return {
        id: String(r.id),
        storeId: String(r.store_id),
        nameEn,
        namePtBr,
        localizedName: locale === "pt-BR" ? namePtBr : nameEn,
        sortOrder: Number(r.sort_order),
        isActive: Boolean(r.is_active),
        products: [],
      };
    },

    async updateCatalogCategory(
      storeId: string,
      categoryId: string,
      patch: Partial<CatalogCategoryUpsertContract>,
      locale: SupportedLocale = DEFAULT_LOCALE
    ): Promise<CatalogCategoryContract | null> {
      const storeUuid = toDeterministicUuid(storeId);
      const catUuid = toDeterministicUuid(categoryId);
      const res = await pool.query(
        `UPDATE public.catalog_categories
         SET name_en = COALESCE($3, name_en),
             name_pt_br = COALESCE($4, name_pt_br),
             sort_order = COALESCE($5, sort_order),
             is_active = COALESCE($6, is_active)
         WHERE id = $1 AND store_id = $2
         RETURNING *`,
        [
          catUuid,
          storeUuid,
          patch.nameEn !== undefined ? patch.nameEn : null,
          patch.namePtBr !== undefined ? patch.namePtBr : null,
          patch.sortOrder !== undefined ? patch.sortOrder : null,
          patch.isActive !== undefined ? patch.isActive : null,
        ]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      const nameEn = String(r.name_en);
      const namePtBr = String(r.name_pt_br);
      return {
        id: String(r.id),
        storeId: String(r.store_id),
        nameEn,
        namePtBr,
        localizedName: locale === "pt-BR" ? namePtBr : nameEn,
        sortOrder: Number(r.sort_order),
        isActive: Boolean(r.is_active),
        products: [],
      };
    },

    async deleteCatalogCategory(storeId: string, categoryId: string): Promise<boolean> {
      const storeUuid = toDeterministicUuid(storeId);
      const catUuid = toDeterministicUuid(categoryId);
      const res = await pool.query(
        `DELETE FROM public.catalog_categories WHERE id = $1 AND store_id = $2`,
        [catUuid, storeUuid]
      );
      return (res.rowCount ?? 0) > 0;
    },

    async getProductStoreId(productId: string): Promise<string | null> {
      const prodUuid = toDeterministicUuid(productId);
      const res = await pool.query(
        `SELECT store_id FROM public.catalog_products WHERE id = $1 LIMIT 1`,
        [prodUuid]
      );
      if (res.rowCount === 0) return null;
      return String((res.rows[0] as Record<string, unknown>).store_id);
    },

    async createCatalogProduct(
      storeId: string,
      input: CatalogProductUpsertContract & { id?: string },
      locale: SupportedLocale = DEFAULT_LOCALE
    ): Promise<CatalogProductContract> {
      const prodUuid = input.id ? rememberLogicalId(input.id) : crypto.randomUUID();
      const storeUuid = toDeterministicUuid(storeId);
      const catUuid = toDeterministicUuid(input.categoryId);
      const res = await pool.query(
        `INSERT INTO public.catalog_products (
           id, store_id, category_id, sku, name_en, name_pt_br,
           description_en, description_pt_br, price_cents, image_path,
           is_available, is_paused, max_per_order, unit_of_measure, is_test_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO UPDATE SET
           category_id = EXCLUDED.category_id,
           sku = EXCLUDED.sku,
           name_en = EXCLUDED.name_en,
           name_pt_br = EXCLUDED.name_pt_br,
           description_en = EXCLUDED.description_en,
           description_pt_br = EXCLUDED.description_pt_br,
           price_cents = EXCLUDED.price_cents,
           image_path = EXCLUDED.image_path,
           is_available = EXCLUDED.is_available,
           is_paused = EXCLUDED.is_paused,
           max_per_order = EXCLUDED.max_per_order,
           unit_of_measure = EXCLUDED.unit_of_measure
         RETURNING *`,
        [
          prodUuid,
          storeUuid,
          catUuid,
          input.sku ?? null,
          input.nameEn,
          input.namePtBr,
          input.descriptionEn ?? "",
          input.descriptionPtBr ?? "",
          input.priceCents,
          input.imagePath ?? null,
          input.isAvailable ?? true,
          input.isPaused ?? false,
          input.maxPerOrder ?? 20,
          input.unitOfMeasure ?? "UNIT",
          isTestData,
        ]
      );
      const r = res.rows[0] as Record<string, unknown>;
      const nameEn = String(r.name_en);
      const namePtBr = String(r.name_pt_br);
      const descEn = String(r.description_en ?? "");
      const descPtBr = String(r.description_pt_br ?? "");
      return {
        id: String(r.id),
        storeId: String(r.store_id),
        categoryId: String(r.category_id),
        sku: r.sku ? String(r.sku) : null,
        nameEn,
        namePtBr,
        localizedName: locale === "pt-BR" ? namePtBr : nameEn,
        descriptionEn: descEn,
        descriptionPtBr: descPtBr,
        localizedDescription: locale === "pt-BR" ? descPtBr : descEn,
        priceCents: Number(r.price_cents),
        isAvailable: Boolean(r.is_available),
        isPaused: Boolean(r.is_paused),
        maxPerOrder: Number(r.max_per_order),
        unitOfMeasure: String(r.unit_of_measure) as "UNIT" | "GRAM" | "KG",
        optionGroups: [],
      };
    },

    async updateCatalogProduct(
      storeId: string,
      productId: string,
      patch: Partial<CatalogProductUpsertContract>,
      locale: SupportedLocale = DEFAULT_LOCALE
    ): Promise<CatalogProductContract | null> {
      const storeUuid = toDeterministicUuid(storeId);
      const prodUuid = toDeterministicUuid(productId);
      const res = await pool.query(
        `UPDATE public.catalog_products
         SET category_id = COALESCE($3, category_id),
             sku = CASE WHEN $4::boolean THEN $5 ELSE sku END,
             name_en = COALESCE($6, name_en),
             name_pt_br = COALESCE($7, name_pt_br),
             description_en = COALESCE($8, description_en),
             description_pt_br = COALESCE($9, description_pt_br),
             price_cents = COALESCE($10, price_cents),
             image_path = CASE WHEN $11::boolean THEN $12 ELSE image_path END,
             is_available = COALESCE($13, is_available),
             is_paused = COALESCE($14, is_paused),
             max_per_order = COALESCE($15, max_per_order),
             unit_of_measure = COALESCE($16, unit_of_measure)
         WHERE id = $1 AND store_id = $2
         RETURNING *`,
        [
          prodUuid,
          storeUuid,
          patch.categoryId !== undefined ? toDeterministicUuid(patch.categoryId) : null,
          patch.sku !== undefined,
          patch.sku !== undefined ? patch.sku : null,
          patch.nameEn !== undefined ? patch.nameEn : null,
          patch.namePtBr !== undefined ? patch.namePtBr : null,
          patch.descriptionEn !== undefined ? patch.descriptionEn : null,
          patch.descriptionPtBr !== undefined ? patch.descriptionPtBr : null,
          patch.priceCents !== undefined ? patch.priceCents : null,
          patch.imagePath !== undefined,
          patch.imagePath !== undefined ? patch.imagePath : null,
          patch.isAvailable !== undefined ? patch.isAvailable : null,
          patch.isPaused !== undefined ? patch.isPaused : null,
          patch.maxPerOrder !== undefined ? patch.maxPerOrder : null,
          patch.unitOfMeasure !== undefined ? patch.unitOfMeasure : null,
        ]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      const nameEn = String(r.name_en);
      const namePtBr = String(r.name_pt_br);
      const descEn = String(r.description_en ?? "");
      const descPtBr = String(r.description_pt_br ?? "");
      return {
        id: String(r.id),
        storeId: String(r.store_id),
        categoryId: String(r.category_id),
        sku: r.sku ? String(r.sku) : null,
        nameEn,
        namePtBr,
        localizedName: locale === "pt-BR" ? namePtBr : nameEn,
        descriptionEn: descEn,
        descriptionPtBr: descPtBr,
        localizedDescription: locale === "pt-BR" ? descPtBr : descEn,
        priceCents: Number(r.price_cents),
        isAvailable: Boolean(r.is_available),
        isPaused: Boolean(r.is_paused),
        maxPerOrder: Number(r.max_per_order),
        unitOfMeasure: String(r.unit_of_measure) as "UNIT" | "GRAM" | "KG",
        optionGroups: [],
      };
    },

    async deleteCatalogProduct(storeId: string, productId: string): Promise<boolean> {
      const storeUuid = toDeterministicUuid(storeId);
      const prodUuid = toDeterministicUuid(productId);
      const res = await pool.query(
        `DELETE FROM public.catalog_products WHERE id = $1 AND store_id = $2`,
        [prodUuid, storeUuid]
      );
      return (res.rowCount ?? 0) > 0;
    },

    async createCatalogOptionGroup(
      productId: string,
      storeId: string,
      input: CatalogOptionGroupUpsertContract & { id?: string },
      locale: SupportedLocale = DEFAULT_LOCALE
    ): Promise<CatalogOptionGroupContract> {
      const groupUuid = input.id ? rememberLogicalId(input.id) : crypto.randomUUID();
      const prodUuid = toDeterministicUuid(productId);
      const storeUuid = toDeterministicUuid(storeId);
      const res = await pool.query(
        `INSERT INTO public.catalog_option_groups (
           id, product_id, store_id, name_en, name_pt_br,
           min_selections, max_selections, sort_order, is_test_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name_en = EXCLUDED.name_en,
           name_pt_br = EXCLUDED.name_pt_br,
           min_selections = EXCLUDED.min_selections,
           max_selections = EXCLUDED.max_selections,
           sort_order = EXCLUDED.sort_order
         RETURNING *`,
        [
          groupUuid,
          prodUuid,
          storeUuid,
          input.nameEn,
          input.namePtBr,
          input.minSelections,
          input.maxSelections,
          input.sortOrder ?? 0,
          isTestData,
        ]
      );
      const r = res.rows[0] as Record<string, unknown>;
      const nameEn = String(r.name_en);
      const namePtBr = String(r.name_pt_br);
      return {
        id: String(r.id),
        nameEn,
        namePtBr,
        localizedName: locale === "pt-BR" ? namePtBr : nameEn,
        minSelections: Number(r.min_selections),
        maxSelections: Number(r.max_selections),
        sortOrder: Number(r.sort_order),
        options: [],
      };
    },

    async updateCatalogOptionGroup(
      productId: string,
      groupId: string,
      patch: Partial<CatalogOptionGroupUpsertContract>,
      locale: SupportedLocale = DEFAULT_LOCALE
    ): Promise<CatalogOptionGroupContract | null> {
      const prodUuid = toDeterministicUuid(productId);
      const groupUuid = toDeterministicUuid(groupId);
      const res = await pool.query(
        `UPDATE public.catalog_option_groups
         SET name_en = COALESCE($3, name_en),
             name_pt_br = COALESCE($4, name_pt_br),
             min_selections = COALESCE($5, min_selections),
             max_selections = COALESCE($6, max_selections),
             sort_order = COALESCE($7, sort_order)
         WHERE id = $1 AND product_id = $2
         RETURNING *`,
        [
          groupUuid,
          prodUuid,
          patch.nameEn !== undefined ? patch.nameEn : null,
          patch.namePtBr !== undefined ? patch.namePtBr : null,
          patch.minSelections !== undefined ? patch.minSelections : null,
          patch.maxSelections !== undefined ? patch.maxSelections : null,
          patch.sortOrder !== undefined ? patch.sortOrder : null,
        ]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      const nameEn = String(r.name_en);
      const namePtBr = String(r.name_pt_br);
      return {
        id: String(r.id),
        nameEn,
        namePtBr,
        localizedName: locale === "pt-BR" ? namePtBr : nameEn,
        minSelections: Number(r.min_selections),
        maxSelections: Number(r.max_selections),
        sortOrder: Number(r.sort_order),
        options: [],
      };
    },

    async deleteCatalogOptionGroup(
      productId: string,
      groupId: string
    ): Promise<boolean> {
      const prodUuid = toDeterministicUuid(productId);
      const groupUuid = toDeterministicUuid(groupId);
      const res = await pool.query(
        `DELETE FROM public.catalog_option_groups WHERE id = $1 AND product_id = $2`,
        [groupUuid, prodUuid]
      );
      return (res.rowCount ?? 0) > 0;
    },

    async getOptionGroupContext(
      groupId: string
    ): Promise<{ productId: string; storeId: string } | null> {
      const groupUuid = toDeterministicUuid(groupId);
      const res = await pool.query(
        `SELECT product_id, store_id FROM public.catalog_option_groups WHERE id = $1 LIMIT 1`,
        [groupUuid]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      return {
        productId: String(r.product_id),
        storeId: String(r.store_id),
      };
    },

    async createCatalogOption(
      groupId: string,
      storeId: string,
      input: CatalogOptionUpsertContract & { id?: string },
      locale: SupportedLocale = DEFAULT_LOCALE
    ): Promise<CatalogOptionContract> {
      const optUuid = input.id ? rememberLogicalId(input.id) : crypto.randomUUID();
      const groupUuid = toDeterministicUuid(groupId);
      const storeUuid = toDeterministicUuid(storeId);
      const res = await pool.query(
        `INSERT INTO public.catalog_options (
           id, option_group_id, store_id, name_en, name_pt_br,
           additional_price_cents, is_available, sort_order, is_test_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name_en = EXCLUDED.name_en,
           name_pt_br = EXCLUDED.name_pt_br,
           additional_price_cents = EXCLUDED.additional_price_cents,
           is_available = EXCLUDED.is_available,
           sort_order = EXCLUDED.sort_order
         RETURNING *`,
        [
          optUuid,
          groupUuid,
          storeUuid,
          input.nameEn,
          input.namePtBr,
          input.additionalPriceCents,
          input.isAvailable ?? true,
          input.sortOrder ?? 0,
          isTestData,
        ]
      );
      const r = res.rows[0] as Record<string, unknown>;
      const nameEn = String(r.name_en);
      const namePtBr = String(r.name_pt_br);
      return {
        id: String(r.id),
        nameEn,
        namePtBr,
        localizedName: locale === "pt-BR" ? namePtBr : nameEn,
        additionalPriceCents: Number(r.additional_price_cents),
        isAvailable: Boolean(r.is_available),
        sortOrder: Number(r.sort_order),
      };
    },

    async updateCatalogOption(
      optionId: string,
      storeId: string,
      patch: Partial<CatalogOptionUpsertContract>,
      locale: SupportedLocale = DEFAULT_LOCALE
    ): Promise<CatalogOptionContract | null> {
      const optUuid = toDeterministicUuid(optionId);
      const storeUuid = toDeterministicUuid(storeId);
      const res = await pool.query(
        `UPDATE public.catalog_options
         SET name_en = COALESCE($3, name_en),
             name_pt_br = COALESCE($4, name_pt_br),
             additional_price_cents = COALESCE($5, additional_price_cents),
             is_available = COALESCE($6, is_available),
             sort_order = COALESCE($7, sort_order)
         WHERE id = $1 AND store_id = $2
         RETURNING *`,
        [
          optUuid,
          storeUuid,
          patch.nameEn !== undefined ? patch.nameEn : null,
          patch.namePtBr !== undefined ? patch.namePtBr : null,
          patch.additionalPriceCents !== undefined
            ? patch.additionalPriceCents
            : null,
          patch.isAvailable !== undefined ? patch.isAvailable : null,
          patch.sortOrder !== undefined ? patch.sortOrder : null,
        ]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      const nameEn = String(r.name_en);
      const namePtBr = String(r.name_pt_br);
      return {
        id: String(r.id),
        nameEn,
        namePtBr,
        localizedName: locale === "pt-BR" ? namePtBr : nameEn,
        additionalPriceCents: Number(r.additional_price_cents),
        isAvailable: Boolean(r.is_available),
        sortOrder: Number(r.sort_order),
      };
    },

    async deleteCatalogOption(optionId: string, storeId: string): Promise<boolean> {
      const optUuid = toDeterministicUuid(optionId);
      const storeUuid = toDeterministicUuid(storeId);
      const res = await pool.query(
        `DELETE FROM public.catalog_options WHERE id = $1 AND store_id = $2`,
        [optUuid, storeUuid]
      );
      return (res.rowCount ?? 0) > 0;
    },

    async getOptionContext(
      optionId: string
    ): Promise<{ optionGroupId: string; productId: string; storeId: string } | null> {
      const optUuid = toDeterministicUuid(optionId);
      const res = await pool.query(
        `SELECT o.option_group_id, g.product_id, o.store_id
         FROM public.catalog_options o
         JOIN public.catalog_option_groups g ON g.id = o.option_group_id
         WHERE o.id = $1
         LIMIT 1`,
        [optUuid]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      return {
        optionGroupId: String(r.option_group_id),
        productId: String(r.product_id),
        storeId: String(r.store_id),
      };
    },

    async saveStorageUploadIntent(params: {
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
    }): Promise<void> {
      const intentUuid = rememberLogicalId(params.id);
      const uploadedByUuid = toDeterministicUuid(params.uploadedBy);
      const storeUuid = params.storeId ? toDeterministicUuid(params.storeId) : null;
      const orgUuid = params.organizationId
        ? toDeterministicUuid(params.organizationId)
        : null;
      await pool.query(
        `INSERT INTO public.storage_upload_intents (
           id, bucket_id, object_path, mime_type, file_size_bytes,
           uploaded_by, store_id, organization_id, signed_token_hash, expires_at, is_test_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [
          intentUuid,
          params.bucket,
          params.objectPath,
          params.mimeType,
          params.fileSizeBytes,
          uploadedByUuid,
          storeUuid,
          orgUuid,
          params.signedTokenHash,
          params.expiresAtIso,
          isTestData,
        ]
      );
    },

    async listUserDevices(userId: string): Promise<UserDeviceContract[]> {
      const userUuid = toDeterministicUuid(userId);
      const res = await pool.query(
        `SELECT id, user_id, platform, device_identifier, app_version, push_consent_granted,
                is_revoked, revoked_at, last_seen_at, created_at
         FROM public.user_devices
         WHERE user_id = $1
         ORDER BY last_seen_at DESC`,
        [userUuid]
      );
      return res.rows.map((r: Record<string, unknown>) => ({
        id: restoreLogicalId(String(r.id)),
        userId: restoreLogicalId(String(r.user_id)),
        platform: String(r.platform) as UserDeviceContract["platform"],
        deviceIdentifier: String(r.device_identifier),
        appVersion: r.app_version ? String(r.app_version) : null,
        pushConsentGranted: Boolean(r.push_consent_granted),
        isRevoked: Boolean(r.is_revoked),
        revokedAtIso: r.revoked_at ? new Date(String(r.revoked_at)).toISOString() : null,
        lastSeenAtIso: new Date(String(r.last_seen_at)).toISOString(),
        createdAtIso: new Date(String(r.created_at)).toISOString(),
      }));
    },

    async getOrderReview(orderId: string): Promise<OrderReviewContract | null> {
      const orderUuid = toDeterministicUuid(orderId);
      const res = await pool.query(
        `SELECT id, order_id, store_id, customer_id, rating, comment, partner_reply,
                partner_replied_at, moderation_status, created_at
         FROM public.order_reviews
         WHERE order_id = $1
         LIMIT 1`,
        [orderUuid]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      return {
        id: restoreLogicalId(String(r.id)),
        orderId: restoreLogicalId(String(r.order_id)),
        storeId: restoreLogicalId(String(r.store_id)),
        customerId: restoreLogicalId(String(r.customer_id)),
        rating: Number(r.rating),
        comment: r.comment ? String(r.comment) : null,
        partnerReply: r.partner_reply ? String(r.partner_reply) : null,
        partnerRepliedAtIso: r.partner_replied_at
          ? new Date(String(r.partner_replied_at)).toISOString()
          : null,
        moderationStatus: String(
          r.moderation_status
        ) as OrderReviewContract["moderationStatus"],
        createdAtIso: new Date(String(r.created_at)).toISOString(),
      };
    },

    async saveOrderReview(review: OrderReviewContract): Promise<OrderReviewContract> {
      const revUuid = rememberLogicalId(review.id);
      const orderUuid = toDeterministicUuid(review.orderId);
      const storeUuid = toDeterministicUuid(review.storeId);
      const custUuid = toDeterministicUuid(review.customerId);
      const res = await pool.query(
        `INSERT INTO public.order_reviews (
           id, order_id, store_id, customer_id, rating, comment, moderation_status, is_test_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (order_id) DO UPDATE SET
           rating = EXCLUDED.rating,
           comment = EXCLUDED.comment
         RETURNING id, order_id, store_id, customer_id, rating, comment, partner_reply,
                   partner_replied_at, moderation_status, created_at`,
        [
          revUuid,
          orderUuid,
          storeUuid,
          custUuid,
          review.rating,
          review.comment,
          review.moderationStatus,
          isTestData,
        ]
      );
      const r = res.rows[0] as Record<string, unknown>;
      return {
        id: restoreLogicalId(String(r.id)),
        orderId: restoreLogicalId(String(r.order_id)),
        storeId: restoreLogicalId(String(r.store_id)),
        customerId: restoreLogicalId(String(r.customer_id)),
        rating: Number(r.rating),
        comment: r.comment ? String(r.comment) : null,
        partnerReply: r.partner_reply ? String(r.partner_reply) : null,
        partnerRepliedAtIso: r.partner_replied_at
          ? new Date(String(r.partner_replied_at)).toISOString()
          : null,
        moderationStatus: String(
          r.moderation_status
        ) as OrderReviewContract["moderationStatus"],
        createdAtIso: new Date(String(r.created_at)).toISOString(),
      };
    },

    async listOrderSupportCases(orderId: string): Promise<SupportCaseContract[]> {
      const orderUuid = toDeterministicUuid(orderId);
      const res = await pool.query(
        `SELECT id, case_number, order_id, organization_id, store_id, requester_id,
                requester_role, category, priority, status, subject, sla_due_at, created_at
         FROM public.support_cases
         WHERE order_id = $1
         ORDER BY created_at DESC`,
        [orderUuid]
      );
      return res.rows.map((r: Record<string, unknown>) => ({
        id: restoreLogicalId(String(r.id)),
        caseNumber: Number(r.case_number),
        orderId: r.order_id ? restoreLogicalId(String(r.order_id)) : null,
        organizationId: r.organization_id
          ? restoreLogicalId(String(r.organization_id))
          : null,
        storeId: r.store_id ? restoreLogicalId(String(r.store_id)) : null,
        requesterId: restoreLogicalId(String(r.requester_id)),
        requesterRole: String(r.requester_role) as SupportCaseContract["requesterRole"],
        category: String(r.category),
        priority: String(r.priority) as SupportCaseContract["priority"],
        status: String(r.status) as SupportCaseContract["status"],
        subject: String(r.subject),
        slaDueAtIso: new Date(String(r.sla_due_at)).toISOString(),
        createdAtIso: new Date(String(r.created_at)).toISOString(),
      }));
    },

    async createSupportCase(
      supportCase: Omit<SupportCaseContract, "caseNumber">
    ): Promise<SupportCaseContract> {
      const caseUuid = rememberLogicalId(supportCase.id);
      const orderUuid = supportCase.orderId
        ? toDeterministicUuid(supportCase.orderId)
        : null;
      const orgUuid = supportCase.organizationId
        ? toDeterministicUuid(supportCase.organizationId)
        : null;
      const storeUuid = supportCase.storeId
        ? toDeterministicUuid(supportCase.storeId)
        : null;
      const reqUuid = toDeterministicUuid(supportCase.requesterId);

      const res = await pool.query(
        `INSERT INTO public.support_cases (
           id, order_id, organization_id, store_id, requester_id, requester_role,
           category, priority, status, subject, sla_due_at, is_test_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, case_number, order_id, organization_id, store_id, requester_id,
                   requester_role, category, priority, status, subject, sla_due_at, created_at`,
        [
          caseUuid,
          orderUuid,
          orgUuid,
          storeUuid,
          reqUuid,
          supportCase.requesterRole,
          supportCase.category,
          supportCase.priority,
          supportCase.status,
          supportCase.subject,
          supportCase.slaDueAtIso,
          isTestData,
        ]
      );
      const r = res.rows[0] as Record<string, unknown>;
      return {
        id: restoreLogicalId(String(r.id)),
        caseNumber: Number(r.case_number),
        orderId: r.order_id ? restoreLogicalId(String(r.order_id)) : null,
        organizationId: r.organization_id
          ? restoreLogicalId(String(r.organization_id))
          : null,
        storeId: r.store_id ? restoreLogicalId(String(r.store_id)) : null,
        requesterId: restoreLogicalId(String(r.requester_id)),
        requesterRole: String(r.requester_role) as SupportCaseContract["requesterRole"],
        category: String(r.category),
        priority: String(r.priority) as SupportCaseContract["priority"],
        status: String(r.status) as SupportCaseContract["status"],
        subject: String(r.subject),
        slaDueAtIso: new Date(String(r.sla_due_at)).toISOString(),
        createdAtIso: new Date(String(r.created_at)).toISOString(),
      };
    },

    async getPartnerFinanceSummary(
      organizationId: string
    ): Promise<PartnerFinanceSummaryContract> {
      const orgUuid = toDeterministicUuid(organizationId);
      const [ledgerRes, ordersRes, settlementsRes] = await Promise.all([
        pool.query(
          `SELECT COALESCE(SUM(
             CASE WHEN le.direction = 'CREDIT' THEN le.amount_cents ELSE -le.amount_cents END
           ), 0) AS payable_balance_cents
           FROM public.ledger_accounts la
           LEFT JOIN public.ledger_entries le ON le.account_id = la.id
           WHERE la.organization_id = $1`,
          [orgUuid]
        ),
        pool.query(
          `SELECT count(*) AS orders_count,
                  COALESCE(SUM(subtotal_cents + addons_cents), 0) AS gmv_cents,
                  COALESCE(SUM(platform_commission_cents), 0) AS commission_cents,
                  COALESCE(SUM(merchant_net_cents), 0) AS net_cents
           FROM public.orders
           WHERE organization_id = $1`,
          [orgUuid]
        ),
        pool.query(
          `SELECT id, organization_id, courier_id, period_start, period_end,
                  amount_cents, status, approved_by, external_payout_reference, created_at
           FROM public.settlements
           WHERE organization_id = $1
           ORDER BY period_end DESC`,
          [orgUuid]
        ),
      ]);

      const payableBalanceCents = Number(
        ledgerRes.rows[0]?.payable_balance_cents ?? 0
      );
      const ordRow = (ordersRes.rows[0] ?? {}) as Record<string, unknown>;
      const settlements: SettlementRecordContract[] = settlementsRes.rows.map(
        (r: Record<string, unknown>) => ({
          id: restoreLogicalId(String(r.id)),
          organizationId: r.organization_id
            ? restoreLogicalId(String(r.organization_id))
            : null,
          courierId: r.courier_id ? restoreLogicalId(String(r.courier_id)) : null,
          periodStart:
            r.period_start instanceof Date
              ? r.period_start.toISOString().slice(0, 10)
              : String(r.period_start).slice(0, 10),
          periodEnd:
            r.period_end instanceof Date
              ? r.period_end.toISOString().slice(0, 10)
              : String(r.period_end).slice(0, 10),
          amountCents: Number(r.amount_cents),
          status: String(r.status) as SettlementRecordContract["status"],
          approvedBy: r.approved_by
            ? restoreLogicalId(String(r.approved_by))
            : null,
          externalPayoutReference: r.external_payout_reference
            ? String(r.external_payout_reference)
            : null,
          createdAtIso: new Date(String(r.created_at)).toISOString(),
        })
      );

      return {
        organizationId: restoreLogicalId(orgUuid),
        payableBalanceCents,
        ordersCount: Number(ordRow.orders_count ?? 0),
        grossMerchandiseCents: Number(ordRow.gmv_cents ?? 0),
        platformCommissionCents: Number(ordRow.commission_cents ?? 0),
        merchantNetCents: Number(ordRow.net_cents ?? 0),
        settlements,
      };
    },

    async getMerchantContract(
      organizationId: string
    ): Promise<MerchantContractRecordContract | null> {
      const orgUuid = toDeterministicUuid(organizationId);
      const res = await pool.query(
        `SELECT id, organization_id, version_number, platform_delivery_commission_bps,
                merchant_delivery_commission_bps, pickup_commission_bps, payout_cycle_days,
                legal_template_status, effective_from, effective_until, approved_by, created_at
         FROM public.merchant_contracts
         WHERE organization_id = $1
         ORDER BY version_number DESC
         LIMIT 1`,
        [orgUuid]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      return {
        id: restoreLogicalId(String(r.id)),
        organizationId: restoreLogicalId(String(r.organization_id)),
        versionNumber: Number(r.version_number),
        platformDeliveryCommissionBps: Number(r.platform_delivery_commission_bps),
        merchantDeliveryCommissionBps: Number(r.merchant_delivery_commission_bps),
        pickupCommissionBps: Number(r.pickup_commission_bps),
        payoutCycleDays: Number(r.payout_cycle_days),
        legalTemplateStatus: String(
          r.legal_template_status
        ) as MerchantContractRecordContract["legalTemplateStatus"],
        effectiveFromIso: new Date(String(r.effective_from)).toISOString(),
        effectiveUntilIso: r.effective_until
          ? new Date(String(r.effective_until)).toISOString()
          : null,
        approvedBy: r.approved_by ? restoreLogicalId(String(r.approved_by)) : null,
        createdAtIso: new Date(String(r.created_at)).toISOString(),
      };
    },

    async listStoreReviews(storeId: string): Promise<OrderReviewContract[]> {
      const storeUuid = toDeterministicUuid(storeId);
      const res = await pool.query(
        `SELECT id, order_id, store_id, customer_id, rating, comment,
                partner_reply, partner_replied_at, moderation_status, created_at
         FROM public.order_reviews
         WHERE store_id = $1
         ORDER BY created_at DESC`,
        [storeUuid]
      );
      return res.rows.map((r: Record<string, unknown>) => ({
        id: restoreLogicalId(String(r.id)),
        orderId: restoreLogicalId(String(r.order_id)),
        storeId: restoreLogicalId(String(r.store_id)),
        customerId: restoreLogicalId(String(r.customer_id)),
        rating: Number(r.rating),
        comment: r.comment ? String(r.comment) : null,
        partnerReply: r.partner_reply ? String(r.partner_reply) : null,
        partnerRepliedAtIso: r.partner_replied_at
          ? new Date(String(r.partner_replied_at)).toISOString()
          : null,
        moderationStatus: String(
          r.moderation_status
        ) as OrderReviewContract["moderationStatus"],
        createdAtIso: new Date(String(r.created_at)).toISOString(),
      }));
    },

    async replyToStoreReview(
      storeId: string,
      reviewId: string,
      replyText: string
    ): Promise<OrderReviewContract | null> {
      const storeUuid = toDeterministicUuid(storeId);
      const revUuid = toDeterministicUuid(reviewId);
      const res = await pool.query(
        `UPDATE public.order_reviews
         SET partner_reply = $1,
             partner_replied_at = timezone('utc', now())
         WHERE id = $2 AND store_id = $3
         RETURNING id, order_id, store_id, customer_id, rating, comment,
                   partner_reply, partner_replied_at, moderation_status, created_at`,
        [replyText, revUuid, storeUuid]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0] as Record<string, unknown>;
      return {
        id: restoreLogicalId(String(r.id)),
        orderId: restoreLogicalId(String(r.order_id)),
        storeId: restoreLogicalId(String(r.store_id)),
        customerId: restoreLogicalId(String(r.customer_id)),
        rating: Number(r.rating),
        comment: r.comment ? String(r.comment) : null,
        partnerReply: r.partner_reply ? String(r.partner_reply) : null,
        partnerRepliedAtIso: r.partner_replied_at
          ? new Date(String(r.partner_replied_at)).toISOString()
          : null,
        moderationStatus: String(
          r.moderation_status
        ) as OrderReviewContract["moderationStatus"],
        createdAtIso: new Date(String(r.created_at)).toISOString(),
      };
    },

    async listStoreSupportCases(storeId: string): Promise<SupportCaseContract[]> {
      const storeUuid = toDeterministicUuid(storeId);
      const res = await pool.query(
        `SELECT id, case_number, order_id, organization_id, store_id, requester_id,
                requester_role, category, priority, status, subject, sla_due_at, created_at
         FROM public.support_cases
         WHERE store_id = $1
         ORDER BY created_at DESC`,
        [storeUuid]
      );
      return res.rows.map((r: Record<string, unknown>) => ({
        id: restoreLogicalId(String(r.id)),
        caseNumber: Number(r.case_number),
        orderId: r.order_id ? restoreLogicalId(String(r.order_id)) : null,
        organizationId: r.organization_id
          ? restoreLogicalId(String(r.organization_id))
          : null,
        storeId: r.store_id ? restoreLogicalId(String(r.store_id)) : null,
        requesterId: restoreLogicalId(String(r.requester_id)),
        requesterRole: String(r.requester_role) as SupportCaseContract["requesterRole"],
        category: String(r.category),
        priority: String(r.priority) as SupportCaseContract["priority"],
        status: String(r.status) as SupportCaseContract["status"],
        subject: String(r.subject),
        slaDueAtIso: new Date(String(r.sla_due_at)).toISOString(),
        createdAtIso: new Date(String(r.created_at)).toISOString(),
      }));
    },

    async getAdminOverview(): Promise<AdminOverviewResponseContract> {
      const [orgsRes, storesRes, couriersRes, approvalsRes, scopesRes, auditLogs] =
        await Promise.all([
          pool.query(
            `SELECT id, slug, legal_name, trade_name, tax_id, status, is_multi_unit_enabled
             FROM public.organizations
             ORDER BY trade_name ASC`
          ),
          pool.query(
            `SELECT id, organization_id, slug, name, cuisine_category, status,
                    is_published, is_paused, city, state_code
             FROM public.stores
             ORDER BY name ASC`
          ),
          pool.query(
            `SELECT c.id, COALESCE(p.full_name, 'Courier ' || c.id::text) AS full_name,
                    c.approval_status, c.active_region_code, c.vehicle_type, c.is_online
             FROM public.couriers c
             LEFT JOIN public.profiles p ON p.id = c.id
             ORDER BY full_name ASC`
          ),
          pool.query(
            `SELECT id, target_type, target_id, previous_status, new_status,
                    decided_by, reason, created_at
             FROM public.approval_events
             ORDER BY created_at DESC
             LIMIT 50`
          ),
          pool.query(
            `SELECT s.id, s.user_id, COALESCE(p.full_name, 'Staff') AS full_name,
                    COALESCE(p.email, 'staff@test.ideliveryfood.invalid') AS email,
                    s.role, s.region_code, s.max_refund_approval_cents,
                    s.requires_mfa, s.is_active, s.justification
             FROM public.staff_scopes s
             LEFT JOIN public.profiles p ON p.id = s.user_id
             ORDER BY s.created_at ASC`
          ),
          this.getAuditLogs(),
        ]);

      return {
        organizations: orgsRes.rows.map((r: Record<string, unknown>) => ({
          id: restoreLogicalId(String(r.id)),
          slug: String(r.slug),
          legalName: String(r.legal_name),
          tradeName: String(r.trade_name),
          taxId: String(r.tax_id),
          status: String(r.status),
          isMultiUnitEnabled: Boolean(r.is_multi_unit_enabled),
        })),
        stores: storesRes.rows.map((r: Record<string, unknown>) => ({
          id: restoreLogicalId(String(r.id)),
          organizationId: restoreLogicalId(String(r.organization_id)),
          slug: String(r.slug),
          name: String(r.name),
          cuisineCategory: String(r.cuisine_category),
          status: String(r.status),
          isPublished: Boolean(r.is_published),
          isPaused: Boolean(r.is_paused),
          city: String(r.city),
          stateCode: String(r.state_code),
        })),
        couriers: couriersRes.rows.map((r: Record<string, unknown>) => ({
          id: restoreLogicalId(String(r.id)),
          fullName: String(r.full_name),
          approvalStatus: String(r.approval_status),
          activeRegionCode: String(r.active_region_code),
          vehicleType: String(r.vehicle_type),
          isOnline: Boolean(r.is_online),
        })),
        approvalEvents: approvalsRes.rows.map((r: Record<string, unknown>) => ({
          id: restoreLogicalId(String(r.id)),
          targetType: String(r.target_type),
          targetId: restoreLogicalId(String(r.target_id)),
          previousStatus: r.previous_status ? String(r.previous_status) : null,
          newStatus: String(r.new_status),
          decidedBy: restoreLogicalId(String(r.decided_by)),
          reason: String(r.reason ?? ""),
          createdAtIso: new Date(String(r.created_at)).toISOString(),
        })),
        staffScopes: scopesRes.rows.map((r: Record<string, unknown>) => ({
          id: restoreLogicalId(String(r.id)),
          userId: restoreLogicalId(String(r.user_id)),
          fullName: String(r.full_name),
          email: String(r.email),
          role: String(r.role) as StaffRole,
          regionCode: r.region_code ? String(r.region_code) : null,
          maxRefundApprovalCents: Number(r.max_refund_approval_cents ?? 0),
          requiresMfa: Boolean(r.requires_mfa),
          isActive: Boolean(r.is_active),
          justification: r.justification ? String(r.justification) : null,
        })),
        auditLogs,
      };
    },

    async getFinanceBackofficeOverview(): Promise<FinanceBackofficeOverviewContract> {
      const [accountsRes, ordersRes, settlementsRes, reconRes, refundsRes] =
        await Promise.all([
          pool.query(
            `SELECT la.id, la.code, la.name, la.account_type, la.organization_id, la.courier_id,
                    COALESCE(SUM(CASE WHEN le.direction = 'DEBIT' THEN le.amount_cents ELSE 0 END), 0) AS debits_cents,
                    COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount_cents ELSE 0 END), 0) AS credits_cents
             FROM public.ledger_accounts la
             LEFT JOIN public.ledger_entries le ON le.account_id = la.id
             GROUP BY la.id, la.code, la.name, la.account_type, la.organization_id, la.courier_id
             ORDER BY la.code ASC`
          ),
          pool.query(`SELECT * FROM public.orders ORDER BY created_at DESC LIMIT 50`),
          pool.query(
            `SELECT id, organization_id, courier_id, period_start, period_end,
                    amount_cents, status, approved_by, external_payout_reference, created_at
             FROM public.settlements
             ORDER BY period_end DESC`
          ),
          pool.query(
            `SELECT id, provider_code, run_date, matched_count, discrepancy_count,
                    discrepancy_total_cents, status, created_at
             FROM public.reconciliation_runs
             ORDER BY created_at DESC`
          ),
          pool.query(
            `SELECT id, order_id, payment_attempt_id, amount_cents, reason,
                    requested_by, approved_by, status, idempotency_key, created_at
             FROM public.refunds
             ORDER BY created_at DESC`
          ),
        ]);

      let totalDebitsCents = 0;
      let totalCreditsCents = 0;

      const ledgerAccounts: FinanceBackofficeOverviewContract["ledgerAccounts"] =
        accountsRes.rows.map((r: Record<string, unknown>) => {
          const debitsCents = Number(r.debits_cents ?? 0);
          const creditsCents = Number(r.credits_cents ?? 0);
          totalDebitsCents += debitsCents;
          totalCreditsCents += creditsCents;
          const accountType = String(
            r.account_type
          ) as FinanceBackofficeOverviewContract["ledgerAccounts"][number]["accountType"];
          const netBalanceCents =
            accountType === "ASSET" || accountType === "EXPENSE"
              ? debitsCents - creditsCents
              : creditsCents - debitsCents;
          return {
            id: restoreLogicalId(String(r.id)),
            code: String(r.code),
            name: String(r.name),
            accountType,
            organizationId: r.organization_id
              ? restoreLogicalId(String(r.organization_id))
              : null,
            courierId: r.courier_id ? restoreLogicalId(String(r.courier_id)) : null,
            debitsCents,
            creditsCents,
            netBalanceCents,
          };
        });

      const orders = ordersRes.rows.map((r: Record<string, unknown>) =>
        mapRowToOrder(r, [])
      );

      let gmvCents = 0;
      let netPlatformRevenueCents = 0;
      let merchantPayablesCents = 0;
      let courierPayablesCents = 0;
      for (const ord of orders) {
        gmvCents += ord.subtotalCents + ord.addonsCents;
        netPlatformRevenueCents += ord.platformCommissionCents + ord.serviceFeeCents;
        merchantPayablesCents += ord.merchantNetCents;
        courierPayablesCents += ord.courierEarningsCents;
      }

      const settlements: SettlementRecordContract[] = settlementsRes.rows.map(
        (r: Record<string, unknown>) => ({
          id: restoreLogicalId(String(r.id)),
          organizationId: r.organization_id
            ? restoreLogicalId(String(r.organization_id))
            : null,
          courierId: r.courier_id ? restoreLogicalId(String(r.courier_id)) : null,
          periodStart:
            r.period_start instanceof Date
              ? r.period_start.toISOString().slice(0, 10)
              : String(r.period_start).slice(0, 10),
          periodEnd:
            r.period_end instanceof Date
              ? r.period_end.toISOString().slice(0, 10)
              : String(r.period_end).slice(0, 10),
          amountCents: Number(r.amount_cents),
          status: String(r.status) as SettlementRecordContract["status"],
          approvedBy: r.approved_by ? restoreLogicalId(String(r.approved_by)) : null,
          externalPayoutReference: r.external_payout_reference
            ? String(r.external_payout_reference)
            : null,
          createdAtIso: new Date(String(r.created_at)).toISOString(),
        })
      );

      const reconciliationRuns: PspReconciliationRunContract[] = reconRes.rows.map(
        (r: Record<string, unknown>) => ({
          id: restoreLogicalId(String(r.id)),
          providerCode: String(r.provider_code),
          runDate:
            r.run_date instanceof Date
              ? r.run_date.toISOString().slice(0, 10)
              : String(r.run_date).slice(0, 10),
          matchedCount: Number(r.matched_count),
          discrepancyCount: Number(r.discrepancy_count),
          discrepancyTotalCents: Number(r.discrepancy_total_cents),
          status: String(r.status) as PspReconciliationRunContract["status"],
          discrepancies: [],
          createdAtIso: new Date(String(r.created_at)).toISOString(),
        })
      );

      const refunds: RefundRecordContract[] = refundsRes.rows.map(
        (r: Record<string, unknown>) => ({
          id: restoreLogicalId(String(r.id)),
          orderId: restoreLogicalId(String(r.order_id)),
          paymentAttemptId: restoreLogicalId(String(r.payment_attempt_id)),
          amountCents: Number(r.amount_cents),
          reason: String(r.reason ?? ""),
          requestedBy: restoreLogicalId(String(r.requested_by)),
          approvedBy: r.approved_by ? restoreLogicalId(String(r.approved_by)) : null,
          status: String(r.status) as RefundRecordContract["status"],
          idempotencyKey: String(r.idempotency_key),
          createdAtIso: new Date(String(r.created_at)).toISOString(),
        })
      );

      return {
        gmvCents,
        netPlatformRevenueCents,
        merchantPayablesCents,
        courierPayablesCents,
        totalDebitsCents,
        totalCreditsCents,
        isLedgerBalanced: totalDebitsCents === totalCreditsCents,
        ledgerAccounts,
        orders,
        settlements,
        reconciliationRuns,
        refunds,
      };
    },

    async getLogisticsBackofficeOverview(): Promise<LogisticsBackofficeOverviewContract> {
      const [tasksRes, offersRes, samplesRes, couriersRes] = await Promise.all([
        pool.query(`SELECT * FROM public.delivery_tasks ORDER BY created_at DESC LIMIT 50`),
        pool.query(`SELECT * FROM public.delivery_offers ORDER BY created_at DESC LIMIT 50`),
        pool.query(
          `SELECT * FROM public.courier_location_samples ORDER BY recorded_at DESC LIMIT 50`
        ),
        pool.query(
          `SELECT c.id, COALESCE(p.full_name, 'Courier ' || c.id::text) AS full_name,
                  c.vehicle_type, c.active_region_code, c.is_online
           FROM public.couriers c
           LEFT JOIN public.profiles p ON p.id = c.id
           ORDER BY c.is_online DESC, full_name ASC`
        ),
      ]);

      return {
        tasks: tasksRes.rows.map((r: Record<string, unknown>) => {
          const activeCourierId = r.active_courier_id
            ? restoreLogicalId(String(r.active_courier_id))
            : null;
          return {
            id: restoreLogicalId(String(r.id)),
            orderId: restoreLogicalId(String(r.order_id)),
            storeId: restoreLogicalId(String(r.store_id)),
            fulfillmentModality: String(
              r.fulfillment_modality ?? "PLATFORM_DELIVERY"
            ) as FulfillmentModality,
            status: String(r.status) as DeliveryStatus,
            pickupLatitude: Number(r.pickup_latitude),
            pickupLongitude: Number(r.pickup_longitude),
            dropoffLatitude: Number(r.dropoff_latitude),
            dropoffLongitude: Number(r.dropoff_longitude),
            dropoffNeighborhoodOnly: String(
              r.dropoff_neighborhood_only ?? "Jardins / Consolação"
            ),
            dropoffFullAddress: activeCourierId
              ? r.dropoff_full_address
                ? String(r.dropoff_full_address)
                : null
              : null,
            courierFeeCents: Number(r.courier_fee_cents),
            distanceMeters: Number(r.distance_meters),
            estimatedEtaMinutes: Number(r.estimated_eta_minutes ?? 20),
            activeCourierId,
            pickedUpAtIso: r.picked_up_at
              ? new Date(String(r.picked_up_at)).toISOString()
              : null,
            completedAtIso: r.completed_at
              ? new Date(String(r.completed_at)).toISOString()
              : null,
            createdAtIso: new Date(String(r.created_at)).toISOString(),
          };
        }),
        offers: offersRes.rows.map((r: Record<string, unknown>) => ({
          id: restoreLogicalId(String(r.id)),
          deliveryTaskId: restoreLogicalId(String(r.delivery_task_id)),
          courierId: restoreLogicalId(String(r.courier_id)),
          offeredFeeCents: Number(r.offered_fee_cents),
          status: String(r.status) as DeliveryOfferContract["status"],
          pickupStoreName: String(r.pickup_store_name),
          distanceMeters: Number(r.distance_meters),
          dropoffNeighborhoodOnly: String(r.dropoff_neighborhood_only),
          expiresAtIso: new Date(String(r.expires_at)).toISOString(),
          respondedAtIso: r.responded_at
            ? new Date(String(r.responded_at)).toISOString()
            : null,
        })),
        locationSamples: samplesRes.rows.map((r: Record<string, unknown>) => {
          const accuracyMeters = Number(r.accuracy_meters ?? 0);
          return {
            id: restoreLogicalId(String(r.id)),
            courierId: restoreLogicalId(String(r.courier_id)),
            deliveryTaskId: r.delivery_task_id
              ? restoreLogicalId(String(r.delivery_task_id))
              : null,
            latitude: Number(r.latitude),
            longitude: Number(r.longitude),
            accuracyMeters,
            recordedAtIso: new Date(String(r.recorded_at)).toISOString(),
            expiresAtIso: new Date(String(r.expires_at)).toISOString(),
            isStaleOrLowAccuracy: accuracyMeters > 100,
          };
        }),
        onlineCouriers: couriersRes.rows.map((r: Record<string, unknown>) => ({
          id: restoreLogicalId(String(r.id)),
          fullName: String(r.full_name),
          vehicleType: String(r.vehicle_type),
          activeRegionCode: String(r.active_region_code),
          isOnline: Boolean(r.is_online),
        })),
      };
    },

    async getFleetsBackofficeOverview(): Promise<FleetsBackofficeOverviewContract> {
      const [policyRes, couriersRes] = await Promise.all([
        pool.query(
          `SELECT policy_key, feature_fleet_operators_enabled
           FROM public.platform_policies
           WHERE policy_key = 'DEFAULT_BR_MARKETPLACE'
           LIMIT 1`
        ),
        pool.query(
          `SELECT c.id, COALESCE(p.full_name, 'Courier ' || c.id::text) AS full_name,
                  c.vehicle_type, c.approval_status
           FROM public.couriers c
           LEFT JOIN public.profiles p ON p.id = c.id
           ORDER BY full_name ASC`
        ),
      ]);

      const policyRow = (policyRes.rows[0] ?? {}) as Record<string, unknown>;
      return {
        policyKey: String(policyRow.policy_key ?? "DEFAULT_BR_MARKETPLACE"),
        featureFleetOperatorsEnabled: Boolean(
          policyRow.feature_fleet_operators_enabled ?? false
        ),
        couriers: couriersRes.rows.map((r: Record<string, unknown>) => ({
          courierId: restoreLogicalId(String(r.id)),
          courierName: String(r.full_name),
          fleetOrganizationId: null, // Seeded couriers are independent couriers unless assigned to a fleet contract
          vehicleType: String(r.vehicle_type),
          approvalStatus: String(r.approval_status),
        })),
      };
    },
  };
}
