/**
 * @ideliveryfood/contracts
 * Shared API envelopes, domain types, money/timezone helpers, and i18n catalogs (en default + pt-BR).
 */

export const SUPPORTED_LOCALES = ["en", "pt-BR"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "en";

export const OPERATIONAL_TIMEZONE = "America/Sao_Paulo" as const;
export const CURRENCY_CODE = "BRL" as const;

export type FulfillmentModality = "PLATFORM_DELIVERY" | "MERCHANT_DELIVERY" | "PICKUP";

export type PartnerRole =
  | "partner_owner"
  | "partner_manager"
  | "partner_operator"
  | "partner_catalog"
  | "partner_finance"
  | "partner_marketing"
  | "partner_support";

export type StaffRole =
  | "support"
  | "support_l1"
  | "support_l2"
  | "operations"
  | "logistics"
  | "finance"
  | "commercial"
  | "marketing"
  | "growth_marketing"
  | "risk_compliance"
  | "auditor_privacy"
  | "tech_admin";

export type AccountStatus =
  | "PENDING_VERIFICATION"
  | "PENDING_APPROVAL"
  | "ACTIVE"
  | "SUSPENDED"
  | "BLOCKED"
  | "DEACTIVATED"
  | "DELETED";

export type ProviderCategory =
  | "PSP"
  | "MAPS"
  | "EMAIL"
  | "PUSH_ANDROID"
  | "PUSH_IOS"
  | "SMS_OTP"
  | "KYC";

export type ProviderReadinessStatus =
  | "ACTIVE"
  | "SANDBOX_READY"
  | "BLOCKED_MISSING_CREDENTIALS"
  | "DISABLED";

export interface ApiErrorDetail {
  field?: string;
  reason: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    correlationId: string;
    timestamp: string;
    details?: ApiErrorDetail[];
  };
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface PublishedStoreContract {
  id: string;
  slug: string;
  name: string;
  descriptionEn: string;
  descriptionPtBr: string;
  localizedDescription: string;
  cuisineCategory: string;
  isPaused: boolean;
  timezone: string;
  city: string;
  stateCode: string;
  latitude?: number;
  longitude?: number;
  minOrderCents: number;
  prepTimeMinMinutes: number;
  prepTimeMaxMinutes: number;
  supportedModalities: FulfillmentModality[];
}

export interface StoreOperatingHourContract {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  opensAt: string; // HH:mm:ss
  closesAt: string; // HH:mm:ss
  isOvernight: boolean;
  isClosed: boolean;
}

export interface StoreHourExceptionContract {
  exceptionDate: string; // YYYY-MM-DD in America/Sao_Paulo
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
  reason: string | null;
}

export interface StoreServiceAreaContract {
  id: string;
  storeId: string;
  name: string;
  radiusMeters: number;
  baseFeeCents: number;
  perKmFeeCents: number;
  freeDeliveryMinOrderCents: number | null;
  estimatedDeliveryMinutes: number;
  isActive: boolean;
}

export type StoreAvailabilityReasonCode =
  | "OPEN"
  | "STORE_PAUSED"
  | "STORE_INACTIVE"
  | "CLOSED_BY_EXCEPTION"
  | "OUTSIDE_OPERATING_HOURS";

export interface StoreAvailabilityEvaluationContract {
  storeId: string;
  isOpen: boolean;
  reasonCode: StoreAvailabilityReasonCode;
  evaluatedAtIso: string;
  operationalTimezone: string;
}

export type ServiceAreaReasonCode =
  | "ELIGIBLE"
  | "PICKUP_NO_RADIUS_REQUIRED"
  | "NO_ACTIVE_SERVICE_AREA"
  | "OUT_OF_RANGE";

export interface ServiceAreaEligibilityContract {
  storeId: string;
  eligible: boolean;
  reasonCode: ServiceAreaReasonCode;
  distanceMeters: number;
  deliveryFeeCents: number;
  estimatedDeliveryMinutes: number;
  matchedServiceAreaId: string | null;
}

export interface CatalogOptionContract {
  id: string;
  nameEn: string;
  namePtBr: string;
  localizedName: string;
  additionalPriceCents: number;
  isAvailable: boolean;
  sortOrder: number;
}

export interface CatalogOptionGroupContract {
  id: string;
  nameEn: string;
  namePtBr: string;
  localizedName: string;
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  options: CatalogOptionContract[];
}

export interface CatalogProductContract {
  id: string;
  storeId: string;
  categoryId: string;
  sku: string | null;
  nameEn: string;
  namePtBr: string;
  localizedName: string;
  descriptionEn: string;
  descriptionPtBr: string;
  localizedDescription: string;
  priceCents: number;
  isAvailable: boolean;
  isPaused: boolean;
  maxPerOrder: number;
  unitOfMeasure: "UNIT" | "GRAM" | "KG";
  optionGroups: CatalogOptionGroupContract[];
}

export interface CatalogCategoryContract {
  id: string;
  storeId: string;
  nameEn: string;
  namePtBr: string;
  localizedName: string;
  sortOrder: number;
  isActive: boolean;
  products: CatalogProductContract[];
}

export interface StoreCatalogResponseContract {
  store: PublishedStoreContract;
  availability: StoreAvailabilityEvaluationContract;
  categories: CatalogCategoryContract[];
}

export interface CustomerAddressContract {
  id: string;
  userId: string;
  label: string;
  recipientName: string;
  streetLine: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  stateCode: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  deliveryInstructions: string | null;
  isDefault: boolean;
}

export interface CartOptionSelectionContract {
  optionGroupId: string;
  optionId: string;
  quantity: number;
}

export interface CartItemSelectionContract {
  productId: string;
  quantity: number;
  selectedOptions: CartOptionSelectionContract[];
  notes?: string;
}

export interface QuoteItemSnapshotContract {
  productId: string;
  productNameEn: string;
  productNamePtBr: string;
  quantity: number;
  unitPriceCents: number;
  addonsUnitPriceCents: number;
  totalLineCents: number;
  notes?: string;
  selectedOptions: Array<{
    optionId: string;
    optionNameEn: string;
    optionNamePtBr: string;
    quantity: number;
    additionalPriceCents: number;
  }>;
}

export interface ServerQuoteRecordContract {
  id: string;
  customerId: string;
  storeId: string;
  addressId: string | null;
  fulfillmentModality: FulfillmentModality;
  promotionCode: string | null;
  currencyCode: typeof CURRENCY_CODE;
  subtotalCents: number;
  addonsCents: number;
  serviceFeeCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  totalCents: number;
  distanceMeters: number;
  estimatedPrepMinutes: number;
  estimatedDeliveryMinutes: number;
  itemsSnapshot: QuoteItemSnapshotContract[];
  addressSnapshot: Record<string, unknown> | null;
  idempotencyKey: string;
  expiresAtIso: string;
  consumedAtIso: string | null;
  createdAtIso: string;
}

export interface OrderRecordContract {
  id: string;
  orderNumber: number;
  customerId: string;
  organizationId: string;
  storeId: string;
  quoteId: string;
  fulfillmentModality: FulfillmentModality;
  orderStatus: string;
  paymentStatus: string;
  deliveryStatus: string;
  currencyCode: typeof CURRENCY_CODE;
  subtotalCents: number;
  addonsCents: number;
  serviceFeeCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  totalCents: number;
  platformCommissionCents: number;
  merchantNetCents: number;
  courierEarningsCents: number;
  deliveryAddressSnapshot: Record<string, unknown> | null;
  itemsSnapshot: QuoteItemSnapshotContract[];
  customerNotes: string | null;
  cancellationReason: string | null;
  cancelledByRole: string | null;
  version: number;
  idempotencyKey: string;
  acceptedAtIso: string | null;
  readyAtIso: string | null;
  deliveredAtIso: string | null;
  cancelledAtIso: string | null;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface OrderEventRecordContract {
  id: string;
  orderId: string;
  actorId: string | null;
  actorRole: string;
  eventType: string;
  previousOrderStatus: string | null;
  newOrderStatus: string;
  previousPaymentStatus: string | null;
  newPaymentStatus: string | null;
  previousDeliveryStatus: string | null;
  newDeliveryStatus: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAtIso: string;
}

export type PaymentMethodCode = "PIX" | "CREDIT_CARD" | "DEBIT_CARD";

export interface PaymentAttemptContract {
  id: string;
  orderId: string;
  customerId: string;
  providerCode: string;
  paymentMethod: PaymentMethodCode;
  amountCents: number;
  currencyCode: typeof CURRENCY_CODE;
  status: string;
  externalPaymentId: string | null;
  idempotencyKey: string;
  isSandbox: boolean;
  errorCode: string | null;
  createdAtIso: string;
}

export interface RefundRecordContract {
  id: string;
  orderId: string;
  paymentAttemptId: string;
  amountCents: number;
  reason: string;
  requestedBy: string;
  approvedBy: string | null;
  status: "PENDING_APPROVAL" | "APPROVED" | "PROCESSED" | "FAILED" | "REJECTED";
  idempotencyKey: string;
  createdAtIso: string;
}

export interface MultiUnitStoreSummaryContract {
  storeId: string;
  storeName: string;
  isPublished: boolean;
  isPaused: boolean;
  activeOrderCount: number;
  grossMerchandiseCents: number;
}

export interface BatchCatalogUpdateItemResultContract {
  storeId: string;
  productId: string;
  status: "APPLIED" | "DENIED_SCOPE" | "NOT_FOUND";
  reasonCode: string;
}

export interface StoreSettingsPatchContract {
  name?: string;
  descriptionEn?: string;
  descriptionPtBr?: string;
  cuisineCategory?: string;
  isPaused?: boolean;
  pauseReason?: string | null;
  minOrderCents?: number;
  prepTimeMinMinutes?: number;
  prepTimeMaxMinutes?: number;
  supportedModalities?: FulfillmentModality[];
}

export interface StoreDetailResponseContract {
  store: PublishedStoreContract;
  availability: StoreAvailabilityEvaluationContract;
  categories: CatalogCategoryContract[];
  serviceAreas: StoreServiceAreaContract[];
  hours: StoreOperatingHourContract[];
  exceptions: StoreHourExceptionContract[];
}

export interface CatalogCategoryUpsertContract {
  nameEn: string;
  namePtBr: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface CatalogProductUpsertContract {
  categoryId: string;
  sku?: string | null;
  nameEn: string;
  namePtBr: string;
  descriptionEn?: string;
  descriptionPtBr?: string;
  priceCents: number;
  imagePath?: string | null;
  isAvailable?: boolean;
  isPaused?: boolean;
  maxPerOrder?: number;
  unitOfMeasure?: "UNIT" | "GRAM" | "KG";
}

export interface CatalogOptionGroupUpsertContract {
  nameEn: string;
  namePtBr: string;
  minSelections: number;
  maxSelections: number;
  sortOrder?: number;
}

export interface CatalogOptionUpsertContract {
  nameEn: string;
  namePtBr: string;
  additionalPriceCents: number;
  isAvailable?: boolean;
  sortOrder?: number;
}

export type AuthorizedStorageBucket =
  | "store-assets"
  | "catalog-media"
  | "partner-kyc-docs"
  | "courier-kyc-docs"
  | "support-attachments"
  | "public-store-assets"
  | "private-kyc-docs"
  | "private-pod-evidence"
  | "private-support-attachments";

export interface SignedUploadUrlRequestContract {
  bucket: AuthorizedStorageBucket;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  storeId?: string | null;
}

export interface SignedUploadUrlResponseContract {
  uploadIntentId: string;
  bucket: AuthorizedStorageBucket;
  objectPath: string;
  signedUploadUrl: string;
  uploadToken: string;
  expiresAtIso: string;
  maxSizeBytes: number;
  allowedMimeTypes: string[];
}

export interface BankAccountChangeRequestContract {
  id: string;
  organizationId: string;
  storeId: string;
  requestedBy: string;
  bankCode: string;
  branchNumber: string;
  accountLast4: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_INFO";
  reason: string;
  createdAtIso: string;
}

export type KitchenQueueColumnStatus =
  | "NEW"
  | "ACCEPTED"
  | "PREPARING"
  | "READY"
  | "IN_TRANSIT"
  | "COMPLETED"
  | "CANCELLED";

export interface KitchenOrderCardContract {
  orderId: string;
  orderNumber: number;
  storeId: string;
  column: KitchenQueueColumnStatus;
  orderStatus: string;
  paymentStatus: string;
  deliveryStatus: string;
  fulfillmentModality: FulfillmentModality;
  totalCents: number;
  itemsCount: number;
  customerNotes: string | null;
  version: number;
  createdAtIso: string;
  slaDeadlineIso: string;
  remainingSlaSeconds: number;
  isSlaBreached: boolean;
}

export interface StoreOrdersQueueResponseContract {
  storeId: string;
  isStorePaused: boolean;
  evaluatedAtIso: string;
  activeOrderCount: number;
  columns: Record<KitchenQueueColumnStatus, KitchenOrderCardContract[]>;
  latestEventCursor: string | null;
}

export interface AdminGovernanceActionContract {
  id: string;
  targetType: "USER" | "ORGANIZATION" | "STORE" | "COURIER" | "BANK_ACCOUNT";
  targetId: string;
  decision: "APPROVED" | "REJECTED" | "NEEDS_INFO" | "SUSPENDED" | "REACTIVATED";
  actorId: string;
  reason: string;
  createdAtIso: string;
}

export interface AdminStaffScopeGrantRequestContract {
  targetUserId: string;
  role: StaffRole;
  regionCode: string | null;
  maxRefundApprovalCents: number;
  justification: string;
}

export interface LedgerAccountBalanceContract {
  accountId: string;
  code: string;
  name: string;
  accountType: "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE";
  organizationId: string | null;
  courierId: string | null;
  currencyCode: typeof CURRENCY_CODE;
  totalDebitsCents: number;
  totalCreditsCents: number;
  netBalanceCents: number;
}

export interface LedgerJournalEntryLineContract {
  accountCode: string;
  direction: "DEBIT" | "CREDIT";
  amountCents: number;
}

export interface LedgerJournalPostContract {
  id: string;
  referenceType:
    | "ORDER_CAPTURE"
    | "ORDER_REFUND"
    | "MERCHANT_SETTLEMENT"
    | "COURIER_PAYOUT"
    | "PROMO_SUBSIDY"
    | "REVERSAL";
  referenceId: string;
  description: string;
  idempotencyKey: string;
  postedBy: string;
  entries: LedgerJournalEntryLineContract[];
  totalDebitsCents: number;
  totalCreditsCents: number;
  createdAtIso: string;
}

export interface PspReconciliationRunContract {
  id: string;
  providerCode: string;
  runDate: string;
  matchedCount: number;
  discrepancyCount: number;
  discrepancyTotalCents: number;
  status: "COMPLETED";
  discrepancies: Array<{
    orderId: string;
    expectedCents: number;
    pspReportedCents: number;
    deltaCents: number;
  }>;
  createdAtIso: string;
}

export interface SettlementRecordContract {
  id: string;
  organizationId: string | null;
  courierId: string | null;
  periodStart: string;
  periodEnd: string;
  amountCents: number;
  status: "SCHEDULED" | "APPROVED" | "PAID_CONFIRMED" | "BLOCKED_NO_PSP";
  approvedBy: string | null;
  externalPayoutReference: string | null;
  createdAtIso: string;
}

export interface DeliveryTaskContract {
  id: string;
  orderId: string;
  storeId: string;
  fulfillmentModality: FulfillmentModality;
  status: string;
  pickupLatitude: number;
  pickupLongitude: number;
  dropoffLatitude: number;
  dropoffLongitude: number;
  dropoffNeighborhoodOnly: string;
  dropoffFullAddress: string | null;
  courierFeeCents: number;
  distanceMeters: number;
  estimatedEtaMinutes: number;
  activeCourierId: string | null;
  pickedUpAtIso: string | null;
  completedAtIso: string | null;
  createdAtIso: string;
}

export interface DeliveryOfferContract {
  id: string;
  deliveryTaskId: string;
  courierId: string;
  offeredFeeCents: number;
  status: "OFFERED" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  pickupStoreName: string;
  distanceMeters: number;
  dropoffNeighborhoodOnly: string;
  expiresAtIso: string;
  respondedAtIso: string | null;
}

export interface CourierLocationSampleContract {
  id: string;
  courierId: string;
  deliveryTaskId: string | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAtIso: string;
  expiresAtIso: string;
  isStaleOrLowAccuracy: boolean;
}

export interface UserPreferencesContract {
  userId: string;
  locale: SupportedLocale;
  pushOrderUpdates: boolean;
  pushPromotions: boolean;
  emailTransactional: boolean;
  emailMarketing: boolean;
}

export interface AuthenticatedActorProfileContract {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  preferredLocale: SupportedLocale;
  status: AccountStatus;
  mfaEnforced: boolean;
  aal: "aal1" | "aal2";
  organizationMemberships: Array<{
    organizationId: string;
    storeId: string | null;
    role: PartnerRole;
  }>;
  staffScopes: Array<{
    role: StaffRole;
    regionCode: string | null;
    maxRefundApprovalCents: number;
    requiresMfa: boolean;
  }>;
}

export interface UserDeviceContract {
  id: string;
  userId: string;
  platform: "ANDROID" | "IOS" | "WEB";
  deviceIdentifier: string;
  appVersion: string | null;
  pushConsentGranted: boolean;
  isRevoked: boolean;
  revokedAtIso: string | null;
  lastSeenAtIso: string;
  createdAtIso: string;
}

export interface OrderReviewContract {
  id: string;
  orderId: string;
  storeId: string;
  customerId: string;
  rating: number;
  comment: string | null;
  partnerReply: string | null;
  partnerRepliedAtIso: string | null;
  moderationStatus: "PUBLISHED" | "HIDDEN_BY_MODERATION";
  createdAtIso: string;
}

export type SupportCaseStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_USER"
  | "WAITING_CUSTOMER"
  | "WAITING_PARTNER"
  | "AWAITING_ACTION_APPROVAL"
  | "ESCALATED_FINANCE"
  | "ESCALATED_LOGISTICS"
  | "RESOLVED"
  | "CLOSED";

export type SupportPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "CRITICAL_IN_ROUTE";

export interface SupportCaseContract {
  id: string;
  caseNumber: number;
  orderId: string | null;
  deliveryTaskId?: string | null;
  organizationId: string | null;
  storeId: string | null;
  requesterId: string;
  requesterRole: "CUSTOMER" | "PARTNER" | "COURIER";
  assignedStaffId?: string | null;
  category: string;
  priority: SupportPriority;
  status: SupportCaseStatus;
  subject: string;
  slaDueAtIso: string;
  resolvedAtIso?: string | null;
  createdAtIso: string;
  updatedAtIso?: string;
}

export interface SupportMessageContract {
  id: string;
  caseId: string;
  senderId: string;
  body: string;
  isInternalNote: boolean;
  createdAtIso: string;
}

export interface SupportAttachmentContract {
  id: string;
  caseId: string;
  messageId: string | null;
  uploadedBy: string;
  storageBucket: string;
  objectPath: string;
  mimeType: string;
  byteSize: number;
  sha256Hex: string;
  isInternalOnly: boolean;
  createdAtIso: string;
}

export interface SupportActionRequestContract {
  id: string;
  caseId: string;
  orderId: string;
  requestedBy: string;
  actionType: "PARTIAL_REFUND" | "FULL_REFUND" | "COURIER_COMPENSATION";
  amountCents: number;
  reason: string;
  status: "PENDING_FINANCE" | "APPROVED" | "REJECTED";
  decidedBy: string | null;
  decidedAtIso?: string | null;
  decisionNotes?: string | null;
  createdAtIso: string;
}

export interface SupportCaseDetailResponseContract {
  supportCase: SupportCaseContract;
  messages: SupportMessageContract[];
  attachments: SupportAttachmentContract[];
  actionRequests: SupportActionRequestContract[];
}

export interface SupportBackofficeOverviewContract {
  autoRefundLimitCents: number;
  cases: SupportCaseContract[];
  messages: SupportMessageContract[];
  attachments: SupportAttachmentContract[];
  actionRequests: SupportActionRequestContract[];
}

export interface MerchantContractRecordContract {
  id: string;
  organizationId: string;
  versionNumber: number;
  platformDeliveryCommissionBps: number;
  merchantDeliveryCommissionBps: number;
  pickupCommissionBps: number;
  payoutCycleDays: number;
  legalTemplateStatus: "PENDING_LEGAL_REVIEW" | "APPROVED_TEMPLATE";
  effectiveFromIso: string;
  effectiveUntilIso: string | null;
  approvedBy: string | null;
  createdAtIso: string;
}

export interface PartnerFinanceSummaryContract {
  organizationId: string;
  payableBalanceCents: number;
  ordersCount: number;
  grossMerchandiseCents: number;
  platformCommissionCents: number;
  merchantNetCents: number;
  settlements: SettlementRecordContract[];
}

export interface AdminOverviewResponseContract {
  organizations: Array<{
    id: string;
    slug: string;
    legalName: string;
    tradeName: string;
    taxId: string;
    status: string;
    isMultiUnitEnabled: boolean;
  }>;
  stores: Array<{
    id: string;
    organizationId: string;
    slug: string;
    name: string;
    cuisineCategory: string;
    status: string;
    isPublished: boolean;
    isPaused: boolean;
    city: string;
    stateCode: string;
  }>;
  couriers: Array<{
    id: string;
    fullName: string;
    approvalStatus: string;
    activeRegionCode: string;
    vehicleType: string;
    isOnline: boolean;
  }>;
  approvalEvents: Array<{
    id: string;
    targetType: string;
    targetId: string;
    previousStatus: string | null;
    newStatus: string;
    decidedBy: string;
    reason: string;
    createdAtIso: string;
  }>;
  staffScopes: Array<{
    id: string;
    userId: string;
    fullName: string;
    email: string;
    role: StaffRole;
    regionCode: string | null;
    maxRefundApprovalCents: number;
    requiresMfa: boolean;
    isActive: boolean;
    justification: string | null;
  }>;
  auditLogs: Array<{
    id: string;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    correlationId: string;
    reason: string | null;
    redactedPayload: Record<string, unknown>;
    createdAt: string;
  }>;
}

export interface FinanceBackofficeOverviewContract {
  gmvCents: number;
  netPlatformRevenueCents: number;
  merchantPayablesCents: number;
  courierPayablesCents: number;
  totalDebitsCents: number;
  totalCreditsCents: number;
  isLedgerBalanced: boolean;
  ledgerAccounts: Array<{
    id: string;
    code: string;
    name: string;
    accountType: "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE";
    organizationId: string | null;
    courierId: string | null;
    debitsCents: number;
    creditsCents: number;
    netBalanceCents: number;
  }>;
  orders: OrderRecordContract[];
  settlements: SettlementRecordContract[];
  reconciliationRuns: PspReconciliationRunContract[];
  refunds: RefundRecordContract[];
}

export interface LogisticsBackofficeOverviewContract {
  tasks: DeliveryTaskContract[];
  offers: DeliveryOfferContract[];
  locationSamples: CourierLocationSampleContract[];
  onlineCouriers: Array<{
    id: string;
    fullName: string;
    vehicleType: string;
    activeRegionCode: string;
    isOnline: boolean;
  }>;
}

export interface FleetsBackofficeOverviewContract {
  policyKey: string;
  featureFleetOperatorsEnabled: boolean;
  couriers: Array<{
    courierId: string;
    courierName: string;
    fleetOrganizationId: string | null;
    vehicleType: string;
    approvalStatus: string;
  }>;
}

/**
 * Validates that a monetary value is a safe non-negative integer in BRL centavos.
 */
export function assertIntegerCents(value: number, fieldName = "amountCents"): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `INVALID_MONETARY_CENTS: '${fieldName}' must be a non-negative safe integer in BRL cents (received ${value}).`
    );
  }
  return value;
}

/**
 * Formats integer centavos into BRL currency without altering currency code when UI locale changes.
 * Example: 3890 -> "R$ 38.90" (en) or "R$ 38,90" (pt-BR), always BRL.
 */
export function formatBrlCents(cents: number, locale: SupportedLocale = DEFAULT_LOCALE): string {
  assertIntegerCents(cents, "cents");
  const majorUnits = cents / 100;
  return new Intl.NumberFormat(locale === "pt-BR" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: CURRENCY_CODE,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(majorUnits);
}

/**
 * Formats an ISO timestamp in the fixed operational timezone (America/Sao_Paulo),
 * regardless of the display language.
 */
export function formatOperationalTimestamp(
  isoDate: string | Date,
  locale: SupportedLocale = DEFAULT_LOCALE
): string {
  const dateObj = typeof isoDate === "string" ? new Date(isoDate) : isoDate;
  if (Number.isNaN(dateObj.getTime())) {
    throw new RangeError("INVALID_TIMESTAMP: Unable to format invalid date.");
  }
  return new Intl.DateTimeFormat(locale === "pt-BR" ? "pt-BR" : "en-US", {
    timeZone: OPERATIONAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(dateObj);
}

export function resolveSupportedLocale(rawLocale?: string | null): SupportedLocale {
  if (!rawLocale) return DEFAULT_LOCALE;
  const normalized = rawLocale.trim().toLowerCase();
  if (normalized === "pt-br" || normalized === "pt_br" || normalized === "pt") {
    return "pt-BR";
  }
  return "en";
}

export const I18N_MESSAGES = {
  en: {
    "app.brand.name": "iDeliveryFood",
    "app.brand.tagline": "Multi-tenant Food Delivery Marketplace",
    "app.locale.selector_label": "Language",
    "app.locale.en": "English (Default)",
    "app.locale.pt_br": "Português (Brasil)",
    "app.state.loading": "Loading live data from platform...",
    "app.state.empty": "No records found for the selected filter.",
    "app.state.error": "Unable to complete request ({code}). Correlation ID: {correlationId}",
    "app.state.offline": "You are currently offline. Reconnecting automatically...",
    "app.state.forbidden": "Access denied. Your role does not have permission for this scope.",
    "app.state.mfa_required": "Multi-factor authentication (MFA aal2) is required to perform this action.",
    "auth.sign_in.title": "Sign in to your account",
    "auth.sign_in.email_label": "Email address",
    "auth.sign_in.submit": "Continue",
    "auth.session.revoked": "Device session revoked successfully.",
    "auth.invitation.expired": "This invitation token has expired or has already been used.",
    "auth.privacy.retention_hold": "Account deletion deferred due to active order or statutory retention hold until {holdUntil}.",
    "marketplace.stores.heading": "Available Restaurants ({count})",
    "marketplace.stores.min_order": "Min. order: {amount}",
    "marketplace.stores.prep_time": "{min}-{max} min",
    "marketplace.store.open": "Open now",
    "marketplace.store.closed": "Closed ({reason})",
    "marketplace.store.paused": "Temporarily paused",
    "marketplace.store.out_of_range": "Outside delivery coverage ({distance}m)",
    "marketplace.store.free_delivery": "Free delivery",
    "marketplace.modality.platform_delivery": "Platform Delivery",
    "marketplace.modality.merchant_delivery": "Store Delivery",
    "marketplace.modality.pickup": "Pickup at Store",
    "catalog.option_group.required": "Required ({min} to {max})",
    "catalog.option_group.optional": "Optional (up to {max})",
    "catalog.product.unavailable": "Currently unavailable",
    "cart.switch_store.confirm_title": "Start a new basket at {newStoreName}?",
    "cart.switch_store.confirm_body": "Your current basket contains items from {currentStoreName}. Confirming will replace your basket.",
    "cart.empty": "Your basket is empty.",
    "checkout.quote.expired": "Your quote expired at {expiresAt}. Please refresh before placing the order.",
    "checkout.psp.blocked_notice": "Online payment capture via {providerCode} is blocked in this environment ({missingVars}). Real payment credentials are required.",
    "checkout.total.label": "Order Total: {amount}",
    "order.status.created": "Order Created",
    "order.status.preparing": "Kitchen is preparing your order",
    "order.status.ready_for_pickup": "Order is ready for pickup",
    "order.status.delivered": "Order delivered",
    "order.status.cancelled": "Order cancelled ({reason})",
    "order.cancel.window_expired": "Direct self-service cancellation window ({seconds}s) has elapsed or kitchen already started preparation.",
    "partner.portal.title": "Partner Portal — Store Operations & Catalog",
    "partner.finance.segregated_notice": "Financial ledger and settlements are restricted to Partner Owner and Partner Finance roles.",
    "partner.multi_unit.batch_summary": "Batch catalog update: {applied} applied, {denied} denied across {total} unit targets.",
    "admin.portal.title": "Admin Backoffice — Governance, RBAC & Provider Status",
    "admin.providers.blocked_badge": "BLOCKED: Missing external credentials ({vars})",
    "admin.self_grant.blocked": "Self-grant blocked: staff members cannot grant or elevate their own administrative roles.",
    "admin.audit.read_only_badge": "Immutable Audit Trail (Read-Only)",
    "mobile.offline.stale_cache_banner": "Offline mode: displaying cached catalog from {cachedAt}. Live prices and checkout require an active connection.",
    "partner.store.paused_banner": "Store is paused for new orders ({reason}). Active orders in the kitchen queue remain visible until completion.",
    "partner.bank_change.pending_approval": "Bank account change request ({accountLast4}) submitted for compliance approval (PENDING). Payouts are not triggered automatically.",
    "kitchen.queue.title": "Kitchen Order Console — Real-Time Queue & SLA",
    "kitchen.order.conflict_notice": "Order #{orderNumber} was already updated by another operator (version {version}). Queue refreshed.",
    "kitchen.sound.consent_label": "Enable audible alert for new incoming orders",
    "finance.gmv_vs_revenue.notice": "Gross Merchandise Value ({gmv}) is distinct from Net Platform Revenue ({netRevenue}). Merchant and courier payables are segregated liabilities.",
    "finance.payout.blocked_no_psp": "Settlement #{settlementId} ({amount}) cannot be liquidated: PSP payout provider ({providerCode}) is BLOCKED_MISSING_CREDENTIALS.",
    "logistics.maps.fallback_notice": "Live map provider ({providerCode}) has no credentials configured. Displaying deterministic Haversine distance ({distance}m) and ETA ({eta} min) without simulated map.",
    "courier.offer.address_privacy_notice": "Exact customer street and number are revealed only after accepting the delivery offer.",
    "courier.gps.permission_denied_notice": "Location permission is denied. Live route tracking is paused; please enable GPS or contact support.",
    "courier.app.title": "iDeliveryFood Courier",
    "courier.status.online": "Online — Ready for dispatch offers",
    "courier.status.offline": "Offline",
    "auth.sign_up.title": "Create your account",
    "auth.recover.title": "Recover your password",
    "customer.addresses.title": "My Delivery Addresses",
    "customer.order_tracking.title": "Order #{orderNumber} — Live Tracking",
    "customer.order_tracking.otp_notice": "Share your 4-digit delivery confirmation code with the courier only upon handoff.",
    "customer.review.title": "Verified Order Review & Support",
    "customer.support.title": "Open Order Support Ticket",
    "customer.profile.title": "My Profile, Devices & LGPD Privacy",
    "support.console.title": "Support & Customer Service Console — SLA Queue & Refund Thresholds",
    "support.case.internal_note_badge": "INTERNAL STAFF NOTE — Never visible to external actors",
    "support.action.auto_approved_notice": "Refund of {amount} auto-approved within support threshold ({limit}).",
    "support.action.escalated_finance_notice": "Refund of {amount} exceeds support threshold ({limit}); escalated to PENDING_FINANCE (requires finance MFA aal2)."
  },
  "pt-BR": {
    "app.brand.name": "iDeliveryFood",
    "app.brand.tagline": "Marketplace Multi-tenant de Delivery de Comida",
    "app.locale.selector_label": "Idioma",
    "app.locale.en": "English (Padrão)",
    "app.locale.pt_br": "Português (Brasil)",
    "app.state.loading": "Carregando dados em tempo real da plataforma...",
    "app.state.empty": "Nenhum registro encontrado para o filtro selecionado.",
    "app.state.error": "Não foi possível concluir a solicitação ({code}). ID de correlação: {correlationId}",
    "app.state.offline": "Você está sem conexão no momento. Reconectando automaticamente...",
    "app.state.forbidden": "Acesso negado. Seu papel não possui permissão para este escopo.",
    "app.state.mfa_required": "Autenticação multifator (MFA aal2) é obrigatória para executar esta ação.",
    "auth.sign_in.title": "Entre na sua conta",
    "auth.sign_in.email_label": "Endereço de e-mail",
    "auth.sign_in.submit": "Continuar",
    "auth.session.revoked": "Sessão do dispositivo revogada com sucesso.",
    "auth.invitation.expired": "Este token de convite expirou ou já foi utilizado.",
    "auth.privacy.retention_hold": "Exclusão de conta retida devido a pedido ativo ou obrigação legal até {holdUntil}.",
    "marketplace.stores.heading": "Restaurantes Disponíveis ({count})",
    "marketplace.stores.min_order": "Pedido mín.: {amount}",
    "marketplace.stores.prep_time": "{min}-{max} min",
    "marketplace.store.open": "Aberto agora",
    "marketplace.store.closed": "Fechado ({reason})",
    "marketplace.store.paused": "Pausado temporariamente",
    "marketplace.store.out_of_range": "Fora da área de entrega ({distance}m)",
    "marketplace.store.free_delivery": "Entrega grátis",
    "marketplace.modality.platform_delivery": "Entrega Parceira da Plataforma",
    "marketplace.modality.merchant_delivery": "Entrega Própria da Loja",
    "marketplace.modality.pickup": "Retirada na Loja",
    "catalog.option_group.required": "Obrigatório ({min} a {max})",
    "catalog.option_group.optional": "Opcional (até {max})",
    "catalog.product.unavailable": "Indisponível no momento",
    "cart.switch_store.confirm_title": "Iniciar uma nova sacola em {newStoreName}?",
    "cart.switch_store.confirm_body": "Sua sacola atual contém itens de {currentStoreName}. Ao confirmar, sua sacola será substituída.",
    "cart.empty": "Sua sacola está vazia.",
    "checkout.quote.expired": "Sua cotação expirou às {expiresAt}. Atualize antes de confirmar o pedido.",
    "checkout.psp.blocked_notice": "A captura de pagamento online via {providerCode} está bloqueada neste ambiente ({missingVars}). Credenciais reais são necessárias.",
    "checkout.total.label": "Total do Pedido: {amount}",
    "order.status.created": "Pedido Criado",
    "order.status.preparing": "A cozinha está preparando seu pedido",
    "order.status.ready_for_pickup": "Pedido pronto para retirada",
    "order.status.delivered": "Pedido entregue",
    "order.status.cancelled": "Pedido cancelado ({reason})",
    "order.cancel.window_expired": "A janela de cancelamento direto ({seconds}s) expirou ou a cozinha já iniciou o preparo.",
    "partner.portal.title": "Portal do Parceiro — Operação de Loja e Catálogo",
    "partner.finance.segregated_notice": "O livro-razão e os repasses financeiros são restritos aos papéis de Proprietário e Financeiro.",
    "partner.multi_unit.batch_summary": "Atualização em lote do catálogo: {applied} aplicadas, {denied} negadas em {total} unidades.",
    "admin.portal.title": "Backoffice Admin — Governança, RBAC e Status de Provedores",
    "admin.providers.blocked_badge": "BLOQUEADO: Credenciais externas ausentes ({vars})",
    "admin.self_grant.blocked": "Autoconcessão bloqueada: membros da equipe não podem conceder ou elevar seus próprios papéis administrativos.",
    "admin.audit.read_only_badge": "Trilha de Auditoria Imutável (Somente Leitura)",
    "mobile.offline.stale_cache_banner": "Modo offline: exibindo catálogo em cache de {cachedAt}. Preços em tempo real e checkout exigem conexão ativa.",
    "partner.store.paused_banner": "A loja está pausada para novos pedidos ({reason}). Os pedidos ativos na fila da cozinha permanecem visíveis até a conclusão.",
    "partner.bank_change.pending_approval": "Solicitação de alteração bancária ({accountLast4}) enviada para aprovação de compliance (PENDING). Repasses não são disparados automaticamente.",
    "kitchen.queue.title": "Gestor Operacional de Pedidos — Fila em Tempo Real e SLA",
    "kitchen.order.conflict_notice": "O pedido #{orderNumber} já foi atualizado por outro operador (versão {version}). Fila sincronizada.",
    "kitchen.sound.consent_label": "Ativar alerta sonoro para novos pedidos",
    "finance.gmv_vs_revenue.notice": "O Volume Bruto de Mercadorias ({gmv}) é distinto da Receita Líquida da Plataforma ({netRevenue}). Repasses de lojas e entregadores são passivos segregados.",
    "finance.payout.blocked_no_psp": "O repasse #{settlementId} ({amount}) não pode ser liquidado: o provedor de pagamento ({providerCode}) está em BLOCKED_MISSING_CREDENTIALS.",
    "logistics.maps.fallback_notice": "O provedor de mapa em tempo real ({providerCode}) está sem credenciais configuradas. Exibindo distância Haversine determinística ({distance}m) e ETA ({eta} min) sem mapa simulado.",
    "courier.offer.address_privacy_notice": "O logradouro e número exatos do cliente são exibidos apenas após o aceite da oferta de entrega.",
    "courier.gps.permission_denied_notice": "Permissão de localização negada. O rastreamento em rota está pausado; ative o GPS ou acione o suporte.",
    "courier.app.title": "iDeliveryFood Entregador",
    "courier.status.online": "Online — Pronto para ofertas de entrega",
    "courier.status.offline": "Offline",
    "auth.sign_up.title": "Crie sua conta",
    "auth.recover.title": "Recuperar sua senha",
    "customer.addresses.title": "Meus Endereços de Entrega",
    "customer.order_tracking.title": "Pedido #{orderNumber} — Acompanhamento em Tempo Real",
    "customer.order_tracking.otp_notice": "Informe seu código de confirmação de entrega de 4 dígitos ao entregador apenas no recebimento.",
    "customer.review.title": "Avaliação Verificada do Pedido e Suporte",
    "customer.support.title": "Abrir Chamado de Suporte do Pedido",
    "customer.profile.title": "Meu Perfil, Dispositivos e Privacidade LGPD",
    "support.console.title": "Console de Atendimento e Suporte — Fila SLA e Alçadas de Reembolso",
    "support.case.internal_note_badge": "NOTA INTERNA DA EQUIPE — Invisível para atores externos",
    "support.action.auto_approved_notice": "Reembolso de {amount} aprovado automaticamente dentro da alçada de suporte ({limit}).",
    "support.action.escalated_finance_notice": "Reembolso de {amount} excede a alçada de suporte ({limit}); escalonado para PENDING_FINANCE (exige finance com MFA aal2)."
  }
} as const;

export type I18nMessageKey = keyof typeof I18N_MESSAGES.en;

/**
 * Translates an i18n message key in the requested locale (falling back to 'en')
 * and interpolates {param} placeholders.
 */
export function translateMessage(
  key: I18nMessageKey,
  locale: SupportedLocale = DEFAULT_LOCALE,
  params?: Record<string, string | number>
): string {
  const catalog = I18N_MESSAGES[locale] ?? I18N_MESSAGES[DEFAULT_LOCALE];
  const template: string = catalog[key] ?? I18N_MESSAGES[DEFAULT_LOCALE][key];
  if (!params) return template;

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, token: string) => {
    const val = params[token];
    return val !== undefined ? String(val) : `{${token}}`;
  });
}
