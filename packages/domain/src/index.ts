import crypto from "node:crypto";
import {
  CURRENCY_CODE,
  OPERATIONAL_TIMEZONE,
  assertIntegerCents,
  type AdminGovernanceActionContract,
  type AdminStaffScopeGrantRequestContract,
  type BankAccountChangeRequestContract,
  type CartItemSelectionContract,
  type CatalogProductContract,
  type CourierLocationSampleContract,
  type DeliveryOfferContract,
  type DeliveryTaskContract,
  type FulfillmentModality,
  type KitchenOrderCardContract,
  type KitchenQueueColumnStatus,
  type LedgerJournalEntryLineContract,
  type LedgerJournalPostContract,
  type OrderEventRecordContract,
  type OrderRecordContract,
  type ProviderReadinessStatus,
  type PspReconciliationRunContract,
  type QuoteItemSnapshotContract,
  type ServerQuoteRecordContract,
  type ServiceAreaEligibilityContract,
  type SettlementRecordContract,
  type StaffRole,
  type StoreAvailabilityEvaluationContract,
  type StoreHourExceptionContract,
  type StoreOperatingHourContract,
  type StoreOrdersQueueResponseContract,
  type StoreServiceAreaContract,
  type StoreSettingsPatchContract,
  type CommercialLeadContract,
  type CommercialLeadStatus,
  type CommercialProposalContract,
  type CommercialProposalStatus,
  type CommissionRuleVersionContract,
  type MerchantContractRecordContract,
  type OrderReviewContract,
  type PromotionCampaignContract,
  type PromotionDiscountType,
  type PromotionFundedBy,
  type PromotionRedemptionContract,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationDeliveryContract,
  type NotificationDeliveryStatus,
  type NotificationTemplateVersionContract,
  type OutboundWebhookEnvelopeContract,
  type AnalyticalKpiSummaryContract,
  type AnalyticalOrderKpiRowContract,
  type ExplainableRiskRuleCode,
  type PrivacyRequestRecordContract,
  type RiskAlertContract,
  type RiskAlertSeverity,
  type RiskAlertStatus,
  type RiskHumanReviewDecision,
  type RiskRuleExplanationContract,
  type SupportedLocale,
  formatBrlCents,
  resolveSupportedLocale,
} from "@ideliveryfood/contracts";

export type OrderStatus =
  | "DRAFT"
  | "QUOTED"
  | "CREATED"
  | "AWAITING_PAYMENT"
  | "PENDING_MERCHANT_ACCEPTANCE"
  | "ACCEPTED"
  | "PREPARING"
  | "READY_FOR_PICKUP"
  | "DISPATCHING"
  | "COURIER_ASSIGNED"
  | "PICKED_UP"
  | "OUT_FOR_DELIVERY"
  | "ARRIVED_AT_DESTINATION"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED"
  | "REJECTED"
  | "DELIVERY_FAILED"
  | "DISPUTED"
  | "REFUNDED";

export type PaymentStatus =
  | "UNPAID"
  | "PENDING"
  | "REQUIRES_ACTION"
  | "AUTHORIZED"
  | "CAPTURED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "FAILED"
  | "CANCELLED"
  | "CHARGEBACK_PENDING"
  | "CHARGEBACK_LOST";

export type DeliveryStatus =
  | "NOT_REQUIRED"
  | "PENDING_DISPATCH"
  | "OFFERING"
  | "ASSIGNED"
  | "ARRIVED_AT_STORE"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "ARRIVED_AT_DROPOFF"
  | "DELIVERED"
  | "RETURNED"
  | "FAILED"
  | "CANCELLED";

const ALLOWED_ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  DRAFT: ["QUOTED", "CANCELLED"],
  QUOTED: ["CREATED", "CANCELLED"],
  CREATED: ["AWAITING_PAYMENT", "PENDING_MERCHANT_ACCEPTANCE", "CANCELLED"],
  AWAITING_PAYMENT: ["PENDING_MERCHANT_ACCEPTANCE", "CANCELLED"],
  PENDING_MERCHANT_ACCEPTANCE: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY_FOR_PICKUP", "DISPATCHING", "CANCELLED"],
  READY_FOR_PICKUP: ["DISPATCHING", "COURIER_ASSIGNED", "PICKED_UP", "COMPLETED", "CANCELLED"],
  DISPATCHING: ["COURIER_ASSIGNED", "CANCELLED"],
  COURIER_ASSIGNED: ["PICKED_UP", "DISPATCHING", "CANCELLED"],
  PICKED_UP: ["OUT_FOR_DELIVERY", "DELIVERY_FAILED"],
  OUT_FOR_DELIVERY: ["ARRIVED_AT_DESTINATION", "DELIVERY_FAILED"],
  ARRIVED_AT_DESTINATION: ["DELIVERED", "DELIVERY_FAILED"],
  DELIVERED: ["COMPLETED", "DISPUTED", "REFUNDED"],
  COMPLETED: ["DISPUTED", "REFUNDED"],
  CANCELLED: ["DISPUTED", "REFUNDED"],
  REJECTED: ["DISPUTED", "REFUNDED"],
  DELIVERY_FAILED: ["DISPUTED", "REFUNDED"],
  DISPUTED: ["COMPLETED", "REFUNDED"],
  REFUNDED: [],
};

const ALLOWED_PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  UNPAID: ["PENDING", "CANCELLED"],
  PENDING: ["REQUIRES_ACTION", "AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED"],
  REQUIRES_ACTION: ["AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED"],
  AUTHORIZED: ["CAPTURED", "CANCELLED", "FAILED"],
  CAPTURED: ["PARTIALLY_REFUNDED", "REFUNDED", "CHARGEBACK_PENDING"],
  PARTIALLY_REFUNDED: ["REFUNDED", "CHARGEBACK_PENDING"],
  REFUNDED: [],
  FAILED: ["PENDING", "CANCELLED"],
  CANCELLED: [],
  CHARGEBACK_PENDING: ["CAPTURED", "CHARGEBACK_LOST"],
  CHARGEBACK_LOST: [],
};

const ALLOWED_DELIVERY_TRANSITIONS: Readonly<Record<DeliveryStatus, readonly DeliveryStatus[]>> = {
  NOT_REQUIRED: [],
  PENDING_DISPATCH: ["OFFERING", "ASSIGNED", "CANCELLED"],
  OFFERING: ["ASSIGNED", "PENDING_DISPATCH", "CANCELLED"],
  ASSIGNED: ["ARRIVED_AT_STORE", "PENDING_DISPATCH", "CANCELLED"],
  ARRIVED_AT_STORE: ["PICKED_UP", "PENDING_DISPATCH", "CANCELLED"],
  PICKED_UP: ["IN_TRANSIT", "RETURNED", "FAILED"],
  IN_TRANSIT: ["ARRIVED_AT_DROPOFF", "RETURNED", "FAILED"],
  ARRIVED_AT_DROPOFF: ["DELIVERED", "RETURNED", "FAILED"],
  DELIVERED: [],
  RETURNED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionPaymentStatus(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionDeliveryStatus(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return ALLOWED_DELIVERY_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================================================
// M04: Store Operating Hours, Overnight Windows, Exceptions & Haversine Radius
// ============================================================================

function parseTimeSeconds(hms: string): number {
  const parts = hms.split(":").map((part) => Number(part));
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const seconds = parts[2] ?? 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function getOperationalDateParts(now: Date, timeZone: string = OPERATIONAL_TIMEZONE): {
  dateStr: string;
  dayOfWeek: number;
  secondsOfDay: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  const year = map.year ?? "2026";
  const month = map.month ?? "01";
  const day = map.day ?? "01";
  const dateStr = `${year}-${month}-${day}`;

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = weekdayMap[map.weekday ?? "Sun"] ?? 0;
  const rawHour = Number(map.hour ?? 0) % 24;
  const minute = Number(map.minute ?? 0);
  const second = Number(map.second ?? 0);
  const secondsOfDay = rawHour * 3600 + minute * 60 + second;

  return { dateStr, dayOfWeek, secondsOfDay };
}

/**
 * Evaluates whether a store is open at a given moment in America/Sao_Paulo,
 * accounting for publication status, manual pause, holiday exceptions, and overnight windows.
 */
export function evaluateStoreAvailability(params: {
  storeId: string;
  isPublished: boolean;
  isPaused: boolean;
  weeklyHours: readonly StoreOperatingHourContract[];
  exceptions?: readonly StoreHourExceptionContract[];
  evaluatedAt?: Date;
  timezone?: string;
}): StoreAvailabilityEvaluationContract {
  const evaluatedAt = params.evaluatedAt ?? new Date();
  const timezone = params.timezone ?? OPERATIONAL_TIMEZONE;

  if (!params.isPublished) {
    return {
      storeId: params.storeId,
      isOpen: false,
      reasonCode: "STORE_INACTIVE",
      evaluatedAtIso: evaluatedAt.toISOString(),
      operationalTimezone: timezone,
    };
  }

  if (params.isPaused) {
    return {
      storeId: params.storeId,
      isOpen: false,
      reasonCode: "STORE_PAUSED",
      evaluatedAtIso: evaluatedAt.toISOString(),
      operationalTimezone: timezone,
    };
  }

  const { dateStr, dayOfWeek, secondsOfDay } = getOperationalDateParts(evaluatedAt, timezone);

  // Check date-specific exceptions first
  const matchingException = (params.exceptions ?? []).find((ex) => ex.exceptionDate === dateStr);
  if (matchingException) {
    if (matchingException.isClosed || !matchingException.opensAt || !matchingException.closesAt) {
      return {
        storeId: params.storeId,
        isOpen: false,
        reasonCode: "CLOSED_BY_EXCEPTION",
        evaluatedAtIso: evaluatedAt.toISOString(),
        operationalTimezone: timezone,
      };
    }
    const exOpenSec = parseTimeSeconds(matchingException.opensAt);
    const exCloseSec = parseTimeSeconds(matchingException.closesAt);
    const isWithinException = secondsOfDay >= exOpenSec && secondsOfDay <= exCloseSec;
    return {
      storeId: params.storeId,
      isOpen: isWithinException,
      reasonCode: isWithinException ? "OPEN" : "OUTSIDE_OPERATING_HOURS",
      evaluatedAtIso: evaluatedAt.toISOString(),
      operationalTimezone: timezone,
    };
  }

  // Check previous day's overnight spillover (e.g., Friday 11:00 -> Saturday 01:00)
  const previousDay = (dayOfWeek + 6) % 7;
  const previousDayWindows = params.weeklyHours.filter(
    (w) => w.dayOfWeek === previousDay && !w.isClosed && w.isOvernight
  );
  for (const prevWindow of previousDayWindows) {
    const closeSec = parseTimeSeconds(prevWindow.closesAt);
    if (secondsOfDay <= closeSec) {
      return {
        storeId: params.storeId,
        isOpen: true,
        reasonCode: "OPEN",
        evaluatedAtIso: evaluatedAt.toISOString(),
        operationalTimezone: timezone,
      };
    }
  }

  // Check current day's operating windows
  const todayWindows = params.weeklyHours.filter((w) => w.dayOfWeek === dayOfWeek && !w.isClosed);
  for (const win of todayWindows) {
    const openSec = parseTimeSeconds(win.opensAt);
    const closeSec = parseTimeSeconds(win.closesAt);
    if (win.isOvernight) {
      if (secondsOfDay >= openSec) {
        return {
          storeId: params.storeId,
          isOpen: true,
          reasonCode: "OPEN",
          evaluatedAtIso: evaluatedAt.toISOString(),
          operationalTimezone: timezone,
        };
      }
    } else if (secondsOfDay >= openSec && secondsOfDay <= closeSec) {
      return {
        storeId: params.storeId,
        isOpen: true,
        reasonCode: "OPEN",
        evaluatedAtIso: evaluatedAt.toISOString(),
        operationalTimezone: timezone,
      };
    }
  }

  return {
    storeId: params.storeId,
    isOpen: false,
    reasonCode: "OUTSIDE_OPERATING_HOURS",
    evaluatedAtIso: evaluatedAt.toISOString(),
    operationalTimezone: timezone,
  };
}

/**
 * Calculates Haversine geographic distance in integer meters between two coordinates.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusMeters * c);
}

/**
 * Evaluates service area radius coverage and calculates distance-based delivery fee in BRL cents (M04).
 */
export function evaluateServiceAreaEligibility(params: {
  storeId: string;
  storeLatitude: number;
  storeLongitude: number;
  customerLatitude: number;
  customerLongitude: number;
  fulfillmentModality: FulfillmentModality;
  grossMerchandiseCents: number;
  serviceAreas: readonly StoreServiceAreaContract[];
}): ServiceAreaEligibilityContract {
  const distanceMeters = calculateHaversineDistanceMeters(
    params.storeLatitude,
    params.storeLongitude,
    params.customerLatitude,
    params.customerLongitude
  );

  if (params.fulfillmentModality === "PICKUP") {
    return {
      storeId: params.storeId,
      eligible: true,
      reasonCode: "PICKUP_NO_RADIUS_REQUIRED",
      distanceMeters,
      deliveryFeeCents: 0,
      estimatedDeliveryMinutes: 0,
      matchedServiceAreaId: null,
    };
  }

  const activeAreas = params.serviceAreas.filter((area) => area.isActive);
  if (activeAreas.length === 0) {
    return {
      storeId: params.storeId,
      eligible: false,
      reasonCode: "NO_ACTIVE_SERVICE_AREA",
      distanceMeters,
      deliveryFeeCents: 0,
      estimatedDeliveryMinutes: 0,
      matchedServiceAreaId: null,
    };
  }

  const matchingAreas = activeAreas
    .filter((area) => distanceMeters <= area.radiusMeters)
    .sort((a, b) => a.radiusMeters - b.radiusMeters);

  const matched = matchingAreas[0];
  if (!matched) {
    return {
      storeId: params.storeId,
      eligible: false,
      reasonCode: "OUT_OF_RANGE",
      distanceMeters,
      deliveryFeeCents: 0,
      estimatedDeliveryMinutes: 0,
      matchedServiceAreaId: null,
    };
  }

  const qualifiesForFreeDelivery =
    matched.freeDeliveryMinOrderCents !== null &&
    params.grossMerchandiseCents >= matched.freeDeliveryMinOrderCents;

  const distanceKmIncrement = Math.max(0, Math.ceil(distanceMeters / 1000) - 1);
  const calculatedFeeCents = qualifiesForFreeDelivery
    ? 0
    : matched.baseFeeCents + distanceKmIncrement * matched.perKmFeeCents;

  return {
    storeId: params.storeId,
    eligible: true,
    reasonCode: "ELIGIBLE",
    distanceMeters,
    deliveryFeeCents: calculatedFeeCents,
    estimatedDeliveryMinutes: matched.estimatedDeliveryMinutes,
    matchedServiceAreaId: matched.id,
  };
}

/**
 * Validates customer cart selections against the authoritative server catalog (product availability,
 * max_per_order, option group min/max rules) and builds immutable item snapshots using server prices (M04/M10).
 */
export function validateAndBuildQuoteItems(params: {
  cartItems: readonly CartItemSelectionContract[];
  catalogProducts: readonly CatalogProductContract[];
}): {
  quoteInputs: QuoteItemInput[];
  snapshots: QuoteItemSnapshotContract[];
} {
  if (params.cartItems.length === 0) {
    throw new Error("QUOTE_EMPTY_ITEMS: At least one item is required.");
  }

  const productById = new Map<string, CatalogProductContract>();
  for (const prod of params.catalogProducts) {
    productById.set(prod.id, prod);
  }

  const quoteInputs: QuoteItemInput[] = [];
  const snapshots: QuoteItemSnapshotContract[] = [];

  for (const selection of params.cartItems) {
    const product = productById.get(selection.productId);
    if (!product) {
      throw new Error(`CATALOG_PRODUCT_NOT_FOUND: Product ${selection.productId} does not exist in store catalog.`);
    }
    if (!product.isAvailable || product.isPaused) {
      throw new Error(`CATALOG_PRODUCT_UNAVAILABLE: Product ${product.nameEn} is currently unavailable.`);
    }
    if (!Number.isSafeInteger(selection.quantity) || selection.quantity <= 0) {
      throw new Error(`QUOTE_INVALID_QUANTITY: Quantity for ${product.id} must be > 0.`);
    }
    if (selection.quantity > product.maxPerOrder) {
      throw new Error(
        `CATALOG_QUANTITY_EXCEEDED: Product ${product.nameEn} allows at most ${product.maxPerOrder} units per order.`
      );
    }

    const selectionsByGroup = new Map<string, Array<{ optionId: string; quantity: number }>>();
    for (const optSel of selection.selectedOptions) {
      const list = selectionsByGroup.get(optSel.optionGroupId) ?? [];
      list.push({ optionId: optSel.optionId, quantity: optSel.quantity });
      selectionsByGroup.set(optSel.optionGroupId, list);
    }

    let addonsUnitPriceCents = 0;
    const optionSnapshots: QuoteItemSnapshotContract["selectedOptions"] = [];

    for (const group of product.optionGroups) {
      const groupSelections = selectionsByGroup.get(group.id) ?? [];
      const totalSelectedInGroup = groupSelections.reduce((acc, item) => acc + item.quantity, 0);

      if (totalSelectedInGroup < group.minSelections) {
        throw new Error(
          `OPTION_GROUP_MIN_NOT_MET: Group '${group.nameEn}' requires at least ${group.minSelections} selection(s).`
        );
      }
      if (totalSelectedInGroup > group.maxSelections) {
        throw new Error(
          `OPTION_GROUP_MAX_EXCEEDED: Group '${group.nameEn}' allows at most ${group.maxSelections} selection(s).`
        );
      }

      for (const chosen of groupSelections) {
        const optionDef = group.options.find((o) => o.id === chosen.optionId);
        if (!optionDef) {
          throw new Error(
            `OPTION_NOT_FOUND: Option ${chosen.optionId} does not belong to group '${group.nameEn}'.`
          );
        }
        if (!optionDef.isAvailable) {
          throw new Error(`OPTION_UNAVAILABLE: Option '${optionDef.nameEn}' is currently unavailable.`);
        }
        addonsUnitPriceCents += optionDef.additionalPriceCents * chosen.quantity;
        optionSnapshots.push({
          optionId: optionDef.id,
          optionNameEn: optionDef.nameEn,
          optionNamePtBr: optionDef.namePtBr,
          quantity: chosen.quantity,
          additionalPriceCents: optionDef.additionalPriceCents,
        });
      }
    }

    const unitPriceCents = product.priceCents;
    const totalLineCents = selection.quantity * (unitPriceCents + addonsUnitPriceCents);

    quoteInputs.push({
      productId: product.id,
      quantity: selection.quantity,
      unitPriceCents,
      addonsUnitPriceCents,
    });

    const snapshotItem: QuoteItemSnapshotContract = {
      productId: product.id,
      productNameEn: product.nameEn,
      productNamePtBr: product.namePtBr,
      quantity: selection.quantity,
      unitPriceCents,
      addonsUnitPriceCents,
      totalLineCents,
      selectedOptions: optionSnapshots,
    };
    if (selection.notes !== undefined) {
      snapshotItem.notes = selection.notes;
    }
    snapshots.push(snapshotItem);
  }

  return { quoteInputs, snapshots };
}

/**
 * Enforces the single-store cart invariant (M05): adding an item from a different store requires
 * explicit user confirmation before clearing the existing cart.
 */
export function evaluateSingleStoreCartAddition(params: {
  currentStoreId: string | null;
  currentItems: readonly CartItemSelectionContract[];
  targetStoreId: string;
  itemToAdd: CartItemSelectionContract;
  confirmSwitchStore?: boolean;
}): {
  allowed: boolean;
  requiresConfirmation: boolean;
  nextStoreId: string | null;
  nextItems: CartItemSelectionContract[];
} {
  if (
    params.currentStoreId !== null &&
    params.currentItems.length > 0 &&
    params.currentStoreId !== params.targetStoreId
  ) {
    if (!params.confirmSwitchStore) {
      return {
        allowed: false,
        requiresConfirmation: true,
        nextStoreId: params.currentStoreId,
        nextItems: [...params.currentItems],
      };
    }
    return {
      allowed: true,
      requiresConfirmation: false,
      nextStoreId: params.targetStoreId,
      nextItems: [params.itemToAdd],
    };
  }

  const existingIndex = params.currentItems.findIndex(
    (i) =>
      i.productId === params.itemToAdd.productId &&
      JSON.stringify(i.selectedOptions) === JSON.stringify(params.itemToAdd.selectedOptions)
  );

  const nextItems = [...params.currentItems];
  if (existingIndex >= 0) {
    const existing = nextItems[existingIndex]!;
    nextItems[existingIndex] = {
      ...existing,
      quantity: existing.quantity + params.itemToAdd.quantity,
    };
  } else {
    nextItems.push(params.itemToAdd);
  }

  return {
    allowed: true,
    requiresConfirmation: false,
    nextStoreId: params.targetStoreId,
    nextItems,
  };
}

export interface QuoteItemInput {
  productId: string;
  quantity: number;
  unitPriceCents: number;
  addonsUnitPriceCents: number;
}

export interface PlatformPolicyConfig {
  platformDeliveryCommissionBps: number;
  merchantDeliveryCommissionBps: number;
  pickupCommissionBps: number;
  serviceFeeBps: number;
  serviceFeeCapCents: number;
}

export const DEFAULT_BR_PLATFORM_POLICY: PlatformPolicyConfig = {
  platformDeliveryCommissionBps: 2300, // 23.00%
  merchantDeliveryCommissionBps: 1200, // 12.00%
  pickupCommissionBps: 1000, // 10.00%
  serviceFeeBps: 500, // 5.00%
  serviceFeeCapCents: 499, // R$ 4,99 cap
};

export interface QuoteAndSplitCalculation {
  subtotalCents: number;
  addonsCents: number;
  grossMerchandiseCents: number;
  serviceFeeCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  totalCents: number;
  platformCommissionCents: number;
  merchantNetCents: number;
  courierEarningsCents: number;
  ledgerDebitsCents: number;
  ledgerCreditsCents: number;
}

/**
 * Authoritative server-side quote and 1-to-N double-entry split calculator in integer BRL cents.
 * Never trusts client-supplied totals.
 */
export function calculateServerQuoteAndSplit(params: {
  items: readonly QuoteItemInput[];
  fulfillmentModality: FulfillmentModality;
  deliveryFeeCents: number;
  discountCents: number;
  discountFundedBy: "PLATFORM" | "MERCHANT" | "STORE" | "SHARED" | "NONE";
  platformSubsidyShareBps?: number;
  minOrderCents: number;
  policy?: PlatformPolicyConfig;
}): QuoteAndSplitCalculation {
  if (params.items.length === 0) {
    throw new Error("QUOTE_EMPTY_ITEMS: At least one item is required to calculate a quote.");
  }

  const policy = params.policy ?? DEFAULT_BR_PLATFORM_POLICY;
  assertIntegerCents(params.deliveryFeeCents, "deliveryFeeCents");
  assertIntegerCents(params.discountCents, "discountCents");
  assertIntegerCents(params.minOrderCents, "minOrderCents");

  let subtotalCents = 0;
  let addonsCents = 0;

  for (const item of params.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(`QUOTE_INVALID_QUANTITY: Quantity for ${item.productId} must be > 0.`);
    }
    assertIntegerCents(item.unitPriceCents, "unitPriceCents");
    assertIntegerCents(item.addonsUnitPriceCents, "addonsUnitPriceCents");
    subtotalCents += item.unitPriceCents * item.quantity;
    addonsCents += item.addonsUnitPriceCents * item.quantity;
  }

  const grossMerchandiseCents = subtotalCents + addonsCents;
  if (grossMerchandiseCents < params.minOrderCents) {
    throw new Error(
      `QUOTE_BELOW_MIN_ORDER: Basket ${grossMerchandiseCents} cents is below store minimum ${params.minOrderCents} cents.`
    );
  }

  const rawServiceFee = Math.round((grossMerchandiseCents * policy.serviceFeeBps) / 10000);
  const serviceFeeCents = Math.min(rawServiceFee, policy.serviceFeeCapCents);

  const effectiveDeliveryFeeCents =
    params.fulfillmentModality === "PICKUP" ? 0 : params.deliveryFeeCents;

  const maxAllowedDiscount = grossMerchandiseCents + serviceFeeCents + effectiveDeliveryFeeCents;
  const discountCents = Math.min(params.discountCents, maxAllowedDiscount);
  const totalCents = maxAllowedDiscount - discountCents;

  const commissionBps =
    params.fulfillmentModality === "PLATFORM_DELIVERY"
      ? policy.platformDeliveryCommissionBps
      : params.fulfillmentModality === "MERCHANT_DELIVERY"
        ? policy.merchantDeliveryCommissionBps
        : policy.pickupCommissionBps;

  const platformCommissionCents = Math.round((grossMerchandiseCents * commissionBps) / 10000);
  const shareBps =
    params.discountFundedBy === "PLATFORM"
      ? 10000
      : params.discountFundedBy === "SHARED"
        ? (params.platformSubsidyShareBps ?? 5000)
        : 0;
  const platformPromoSubsidyCents =
    params.discountFundedBy === "NONE" ? 0 : Math.round((discountCents * shareBps) / 10000);
  const merchantDiscountDeduction =
    params.discountFundedBy === "NONE" ? 0 : discountCents - platformPromoSubsidyCents;

  const courierEarningsCents =
    params.fulfillmentModality === "PLATFORM_DELIVERY" ? effectiveDeliveryFeeCents : 0;
  const merchantDeliveryShareCents =
    params.fulfillmentModality === "MERCHANT_DELIVERY" ? effectiveDeliveryFeeCents : 0;

  // Double-entry balance guarantee:
  // Debits = totalCents (customer capture) + platformPromoSubsidyCents
  // Credits = merchantNetCents + courierEarningsCents + platformCommissionCents + serviceFeeCents
  const ledgerDebitsCents = totalCents + platformPromoSubsidyCents;
  const merchantNetCents =
    grossMerchandiseCents +
    merchantDeliveryShareCents -
    platformCommissionCents -
    merchantDiscountDeduction;

  const ledgerCreditsCents =
    merchantNetCents + courierEarningsCents + platformCommissionCents + serviceFeeCents;

  return {
    subtotalCents,
    addonsCents,
    grossMerchandiseCents,
    serviceFeeCents,
    deliveryFeeCents: effectiveDeliveryFeeCents,
    discountCents,
    totalCents,
    platformCommissionCents,
    merchantNetCents,
    courierEarningsCents,
    ledgerDebitsCents,
    ledgerCreditsCents,
  };
}

// ============================================================================
// M10: Order Creation from Quote, State Machine Commands & Late PSP Capture
// ============================================================================

export type OrderCommandType =
  | "CONFIRM_PAYMENT"
  | "ACCEPT"
  | "REJECT"
  | "START_PREPARING"
  | "MARK_READY"
  | "DISPATCH"
  | "PICK_UP"
  | "DELIVER"
  | "COMPLETE"
  | "CANCEL";

export interface OutboxEventDraft {
  id: string;
  aggregateType: "ORDER" | "PAYMENT" | "REFUND";
  aggregateId: string;
  eventType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAtIso: string;
}

/**
 * Creates an immutable order, initial append-only order_event, and transactional outbox_event
 * from a valid, unexpired, unconsumed server quote (M10).
 */
export function createOrderFromServerQuote(params: {
  orderId: string;
  orderNumber: number;
  organizationId: string;
  quote: ServerQuoteRecordContract;
  actorCustomerId: string;
  isStoreCurrentlyOpen: boolean;
  discountFundedBy: "PLATFORM" | "MERCHANT" | "STORE" | "SHARED" | "NONE";
  platformSubsidyShareBps?: number;
  customerNotes?: string | null;
  idempotencyKey: string;
  now?: Date;
}): {
  order: OrderRecordContract;
  initialEvent: OrderEventRecordContract;
  outboxEvent: OutboxEventDraft;
} {
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();

  if (params.quote.customerId !== params.actorCustomerId) {
    throw new Error("QUOTE_OWNERSHIP_MISMATCH: Quote does not belong to the authenticated customer.");
  }

  if (params.quote.consumedAtIso !== null) {
    throw new Error("QUOTE_ALREADY_CONSUMED: This quote has already been converted into an order.");
  }

  if (new Date(params.quote.expiresAtIso).getTime() <= now.getTime()) {
    throw new Error(`QUOTE_EXPIRED: Quote expired at ${params.quote.expiresAtIso}.`);
  }

  if (!params.isStoreCurrentlyOpen) {
    throw new Error("STORE_CLOSED_AT_CHECKOUT: Store is no longer open for new orders.");
  }

  const split = calculateServerQuoteAndSplit({
    items: params.quote.itemsSnapshot.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      addonsUnitPriceCents: item.addonsUnitPriceCents,
    })),
    fulfillmentModality: params.quote.fulfillmentModality,
    deliveryFeeCents: params.quote.deliveryFeeCents,
    discountCents: params.quote.discountCents,
    discountFundedBy: params.discountFundedBy,
    ...(params.platformSubsidyShareBps !== undefined
      ? { platformSubsidyShareBps: params.platformSubsidyShareBps }
      : {}),
    minOrderCents: 0,
  });

  const initialDeliveryStatus: DeliveryStatus =
    params.quote.fulfillmentModality === "PICKUP" ? "NOT_REQUIRED" : "PENDING_DISPATCH";

  const order: OrderRecordContract = {
    id: params.orderId,
    orderNumber: params.orderNumber,
    customerId: params.actorCustomerId,
    organizationId: params.organizationId,
    storeId: params.quote.storeId,
    quoteId: params.quote.id,
    fulfillmentModality: params.quote.fulfillmentModality,
    orderStatus: "AWAITING_PAYMENT",
    paymentStatus: "PENDING",
    deliveryStatus: initialDeliveryStatus,
    currencyCode: CURRENCY_CODE,
    subtotalCents: split.subtotalCents,
    addonsCents: split.addonsCents,
    serviceFeeCents: split.serviceFeeCents,
    deliveryFeeCents: split.deliveryFeeCents,
    discountCents: split.discountCents,
    totalCents: split.totalCents,
    platformCommissionCents: split.platformCommissionCents,
    merchantNetCents: split.merchantNetCents,
    courierEarningsCents: split.courierEarningsCents,
    deliveryAddressSnapshot: params.quote.addressSnapshot,
    itemsSnapshot: params.quote.itemsSnapshot,
    customerNotes: params.customerNotes ?? null,
    cancellationReason: null,
    cancelledByRole: null,
    version: 1,
    idempotencyKey: params.idempotencyKey,
    acceptedAtIso: null,
    readyAtIso: null,
    deliveredAtIso: null,
    cancelledAtIso: null,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  };

  const initialEvent: OrderEventRecordContract = {
    id: `oevt_${params.orderId}_1`,
    orderId: params.orderId,
    actorId: params.actorCustomerId,
    actorRole: "CUSTOMER",
    eventType: "ORDER_CREATED",
    previousOrderStatus: null,
    newOrderStatus: order.orderStatus,
    previousPaymentStatus: null,
    newPaymentStatus: order.paymentStatus,
    previousDeliveryStatus: null,
    newDeliveryStatus: order.deliveryStatus,
    idempotencyKey: `${params.idempotencyKey}:created`,
    payload: {
      quoteId: params.quote.id,
      totalCents: order.totalCents,
    },
    createdAtIso: nowIso,
  };

  const outboxEvent: OutboxEventDraft = {
    id: `obx_${params.orderId}_1`,
    aggregateType: "ORDER",
    aggregateId: params.orderId,
    eventType: "ORDER_CREATED",
    idempotencyKey: `${params.idempotencyKey}:outbox`,
    payload: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      storeId: order.storeId,
      customerId: order.customerId,
      totalCents: order.totalCents,
    },
    createdAtIso: nowIso,
  };

  return { order, initialEvent, outboxEvent };
}

/**
 * Executes an order state transition command with optimistic concurrency checking (expectedVersion),
 * actor authorization, cancellation window validation, and append-only event generation (M10).
 */
export function executeOrderCommand(params: {
  order: OrderRecordContract;
  command: OrderCommandType;
  expectedVersion: number;
  actorId: string;
  actorRole: "CUSTOMER" | "PARTNER" | "COURIER" | "STAFF" | "SYSTEM";
  idempotencyKey: string;
  reason?: string;
  freeCancelWindowSeconds?: number;
  now?: Date;
}): {
  updatedOrder: OrderRecordContract;
  event: OrderEventRecordContract;
  outboxEvent: OutboxEventDraft;
} {
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();

  if (params.expectedVersion !== params.order.version) {
    throw new Error(
      `ORDER_VERSION_CONFLICT: Expected version ${params.expectedVersion} but current order version is ${params.order.version}.`
    );
  }

  const currentOrderStatus = params.order.orderStatus as OrderStatus;
  let nextOrderStatus: OrderStatus = currentOrderStatus;
  let nextPaymentStatus = params.order.paymentStatus as PaymentStatus;
  let nextDeliveryStatus = params.order.deliveryStatus as DeliveryStatus;

  switch (params.command) {
    case "CONFIRM_PAYMENT": {
      nextOrderStatus = "PENDING_MERCHANT_ACCEPTANCE";
      nextPaymentStatus = "CAPTURED";
      break;
    }
    case "ACCEPT": {
      if (params.actorRole !== "PARTNER" && params.actorRole !== "STAFF") {
        throw new Error("ORDER_COMMAND_FORBIDDEN: Only store partner or staff can ACCEPT an order.");
      }
      nextOrderStatus = "ACCEPTED";
      break;
    }
    case "REJECT": {
      if (params.actorRole !== "PARTNER" && params.actorRole !== "STAFF") {
        throw new Error("ORDER_COMMAND_FORBIDDEN: Only store partner or staff can REJECT an order.");
      }
      nextOrderStatus = "REJECTED";
      if (nextDeliveryStatus !== "NOT_REQUIRED") {
        nextDeliveryStatus = "CANCELLED";
      }
      break;
    }
    case "START_PREPARING": {
      if (params.actorRole !== "PARTNER" && params.actorRole !== "STAFF") {
        throw new Error("ORDER_COMMAND_FORBIDDEN: Only store partner or staff can START_PREPARING.");
      }
      nextOrderStatus = "PREPARING";
      break;
    }
    case "MARK_READY": {
      if (params.actorRole !== "PARTNER" && params.actorRole !== "STAFF") {
        throw new Error("ORDER_COMMAND_FORBIDDEN: Only store partner or staff can MARK_READY.");
      }
      nextOrderStatus = "READY_FOR_PICKUP";
      break;
    }
    case "DISPATCH": {
      nextOrderStatus = "DISPATCHING";
      nextDeliveryStatus = "OFFERING";
      break;
    }
    case "PICK_UP": {
      nextOrderStatus = "PICKED_UP";
      nextDeliveryStatus = "PICKED_UP";
      break;
    }
    case "DELIVER": {
      nextOrderStatus = "DELIVERED";
      if (nextDeliveryStatus !== "NOT_REQUIRED") {
        nextDeliveryStatus = "DELIVERED";
      }
      break;
    }
    case "COMPLETE": {
      nextOrderStatus = "COMPLETED";
      break;
    }
    case "CANCEL": {
      const freeCancelWindowSeconds = params.freeCancelWindowSeconds ?? 120;
      if (params.actorRole === "CUSTOMER") {
        const customerCancellableStatuses: readonly OrderStatus[] = [
          "CREATED",
          "AWAITING_PAYMENT",
          "PENDING_MERCHANT_ACCEPTANCE",
        ];
        const ageSeconds =
          (now.getTime() - new Date(params.order.createdAtIso).getTime()) / 1000;
        if (
          !customerCancellableStatuses.includes(currentOrderStatus) ||
          ageSeconds > freeCancelWindowSeconds
        ) {
          throw new Error(
            `ORDER_CANCEL_WINDOW_EXPIRED: Customer direct cancellation is only allowed before acceptance within ${freeCancelWindowSeconds}s.`
          );
        }
      }
      nextOrderStatus = "CANCELLED";
      if (nextDeliveryStatus !== "NOT_REQUIRED" && nextDeliveryStatus !== "DELIVERED") {
        nextDeliveryStatus = "CANCELLED";
      }
      break;
    }
  }

  if (!canTransitionOrderStatus(currentOrderStatus, nextOrderStatus)) {
    throw new Error(
      `ORDER_INVALID_TRANSITION: Cannot transition order ${params.order.id} from ${currentOrderStatus} to ${nextOrderStatus} via ${params.command}.`
    );
  }

  const nextVersion = params.order.version + 1;
  const updatedOrder: OrderRecordContract = {
    ...params.order,
    orderStatus: nextOrderStatus,
    paymentStatus: nextPaymentStatus,
    deliveryStatus: nextDeliveryStatus,
    version: nextVersion,
    cancellationReason:
      params.command === "CANCEL" || params.command === "REJECT"
        ? (params.reason ?? "Cancelled")
        : params.order.cancellationReason,
    cancelledByRole:
      params.command === "CANCEL" || params.command === "REJECT"
        ? params.actorRole
        : params.order.cancelledByRole,
    acceptedAtIso:
      params.command === "ACCEPT" ? nowIso : params.order.acceptedAtIso,
    readyAtIso:
      params.command === "MARK_READY" ? nowIso : params.order.readyAtIso,
    deliveredAtIso:
      params.command === "DELIVER" ? nowIso : params.order.deliveredAtIso,
    cancelledAtIso:
      params.command === "CANCEL" || params.command === "REJECT"
        ? nowIso
        : params.order.cancelledAtIso,
    updatedAtIso: nowIso,
  };

  const event: OrderEventRecordContract = {
    id: `oevt_${params.order.id}_${nextVersion}`,
    orderId: params.order.id,
    actorId: params.actorId,
    actorRole: params.actorRole,
    eventType: `ORDER_${params.command}`,
    previousOrderStatus: currentOrderStatus,
    newOrderStatus: nextOrderStatus,
    previousPaymentStatus: params.order.paymentStatus,
    newPaymentStatus: nextPaymentStatus,
    previousDeliveryStatus: params.order.deliveryStatus,
    newDeliveryStatus: nextDeliveryStatus,
    idempotencyKey: params.idempotencyKey,
    payload: {
      command: params.command,
      reason: params.reason ?? null,
      version: nextVersion,
    },
    createdAtIso: nowIso,
  };

  const outboxEvent: OutboxEventDraft = {
    id: `obx_${params.order.id}_${nextVersion}`,
    aggregateType: "ORDER",
    aggregateId: params.order.id,
    eventType: `ORDER_${nextOrderStatus}`,
    idempotencyKey: `${params.idempotencyKey}:outbox`,
    payload: {
      orderId: params.order.id,
      orderStatus: nextOrderStatus,
      paymentStatus: nextPaymentStatus,
      deliveryStatus: nextDeliveryStatus,
      version: nextVersion,
    },
    createdAtIso: nowIso,
  };

  return { updatedOrder, event, outboxEvent };
}

// ============================================================================
// M12: PSP Webhook Signature, Replay Window, Deduplication & Refunds
// ============================================================================

/**
 * Computes an HMAC-SHA256 webhook signature (`v1=<hex>`) over `${timestampSeconds}.${rawPayload}`.
 */
export function computePspWebhookSignature(params: {
  webhookSecret: string;
  timestampSeconds: number;
  rawPayload: string;
}): string {
  const signedContent = `${params.timestampSeconds}.${params.rawPayload}`;
  const digest = crypto
    .createHmac("sha256", params.webhookSecret)
    .update(signedContent, "utf8")
    .digest("hex");
  return `v1=${digest}`;
}

export interface PspWebhookProcessingResult {
  deduplicated: boolean;
  action:
    | "NO_OP_DUPLICATE"
    | "ORDER_PAYMENT_CAPTURED"
    | "ORDER_PAYMENT_FAILED"
    | "LATE_CAPTURE_CONFLICT_QUEUED_FOR_REFUND";
  updatedOrder: OrderRecordContract;
  event: OrderEventRecordContract | null;
}

/**
 * Verifies PSP webhook authenticity (HMAC-SHA256), timestamp replay tolerance window (300s),
 * deduplicates `(providerCode, externalEventId)`, validates amount/currency (`BRL`), and
 * reconciles late capture on cancelled/expired orders as a financial exception (M10/M12).
 */
export function verifyAndProcessPspWebhook(params: {
  providerCode: string;
  externalEventId: string;
  eventType: "payment.captured" | "payment.failed";
  webhookSecret: string;
  signatureHeader: string;
  timestampSeconds: number;
  nowSeconds: number;
  toleranceSeconds?: number;
  rawPayload: string;
  webhookAmountCents: number;
  webhookCurrencyCode: string;
  order: OrderRecordContract;
  processedEventKeys: ReadonlySet<string>;
}): PspWebhookProcessingResult {
  const toleranceSeconds = params.toleranceSeconds ?? 300;
  if (Math.abs(params.nowSeconds - params.timestampSeconds) > toleranceSeconds) {
    throw new Error(
      `WEBHOOK_TIMESTAMP_OUT_OF_WINDOW: Webhook timestamp ${params.timestampSeconds} exceeds tolerance of ${toleranceSeconds}s.`
    );
  }

  const expectedSignature = computePspWebhookSignature({
    webhookSecret: params.webhookSecret,
    timestampSeconds: params.timestampSeconds,
    rawPayload: params.rawPayload,
  });

  const providedBuf = Buffer.from(params.signatureHeader, "utf8");
  const expectedBuf = Buffer.from(expectedSignature, "utf8");
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    throw new Error("WEBHOOK_INVALID_SIGNATURE: HMAC-SHA256 signature verification failed.");
  }

  const dedupKey = `${params.providerCode}:${params.externalEventId}`;
  if (params.processedEventKeys.has(dedupKey)) {
    return {
      deduplicated: true,
      action: "NO_OP_DUPLICATE",
      updatedOrder: params.order,
      event: null,
    };
  }

  if (params.webhookCurrencyCode !== CURRENCY_CODE) {
    throw new Error(
      `WEBHOOK_CURRENCY_MISMATCH: Expected ${CURRENCY_CODE}, received ${params.webhookCurrencyCode}.`
    );
  }

  if (params.webhookAmountCents !== params.order.totalCents) {
    throw new Error(
      `WEBHOOK_AMOUNT_MISMATCH: Webhook amount ${params.webhookAmountCents} does not match order total ${params.order.totalCents}.`
    );
  }

  const nowIso = new Date(params.nowSeconds * 1000).toISOString();

  // Handle late capture arriving after order was already cancelled or rejected (M10/M12 invariant)
  if (
    params.eventType === "payment.captured" &&
    (params.order.orderStatus === "CANCELLED" || params.order.orderStatus === "REJECTED")
  ) {
    const nextVersion = params.order.version + 1;
    const disputedOrder: OrderRecordContract = {
      ...params.order,
      orderStatus: "DISPUTED",
      paymentStatus: "CAPTURED",
      version: nextVersion,
      updatedAtIso: nowIso,
    };
    const conflictEvent: OrderEventRecordContract = {
      id: `oevt_${params.order.id}_${nextVersion}`,
      orderId: params.order.id,
      actorId: null,
      actorRole: "SYSTEM_WEBHOOK",
      eventType: "LATE_PSP_CAPTURE_ON_TERMINATED_ORDER",
      previousOrderStatus: params.order.orderStatus,
      newOrderStatus: "DISPUTED",
      previousPaymentStatus: params.order.paymentStatus,
      newPaymentStatus: "CAPTURED",
      previousDeliveryStatus: params.order.deliveryStatus,
      newDeliveryStatus: params.order.deliveryStatus,
      idempotencyKey: dedupKey,
      payload: {
        providerCode: params.providerCode,
        externalEventId: params.externalEventId,
        reconciliationAction: "AUTO_REFUND_QUEUED",
      },
      createdAtIso: nowIso,
    };
    return {
      deduplicated: false,
      action: "LATE_CAPTURE_CONFLICT_QUEUED_FOR_REFUND",
      updatedOrder: disputedOrder,
      event: conflictEvent,
    };
  }

  if (params.eventType === "payment.captured") {
    const result = executeOrderCommand({
      order: params.order,
      command: "CONFIRM_PAYMENT",
      expectedVersion: params.order.version,
      actorId: "system_webhook",
      actorRole: "SYSTEM",
      idempotencyKey: dedupKey,
      now: new Date(params.nowSeconds * 1000),
    });
    return {
      deduplicated: false,
      action: "ORDER_PAYMENT_CAPTURED",
      updatedOrder: result.updatedOrder,
      event: result.event,
    };
  }

  // payment.failed
  const nextVersion = params.order.version + 1;
  const failedOrder: OrderRecordContract = {
    ...params.order,
    paymentStatus: "FAILED",
    version: nextVersion,
    updatedAtIso: nowIso,
  };
  const failedEvent: OrderEventRecordContract = {
    id: `oevt_${params.order.id}_${nextVersion}`,
    orderId: params.order.id,
    actorId: null,
    actorRole: "SYSTEM_WEBHOOK",
    eventType: "PAYMENT_FAILED",
    previousOrderStatus: params.order.orderStatus,
    newOrderStatus: params.order.orderStatus,
    previousPaymentStatus: params.order.paymentStatus,
    newPaymentStatus: "FAILED",
    previousDeliveryStatus: params.order.deliveryStatus,
    newDeliveryStatus: params.order.deliveryStatus,
    idempotencyKey: dedupKey,
    payload: {
      providerCode: params.providerCode,
      externalEventId: params.externalEventId,
    },
    createdAtIso: nowIso,
  };

  return {
    deduplicated: false,
    action: "ORDER_PAYMENT_FAILED",
    updatedOrder: failedOrder,
    event: failedEvent,
  };
}

/**
 * Evaluates a partial or full refund request against captured amount, prior refunds,
 * staff ABAC ceiling (`maxRefundApprovalCents`), and MFA `aal2`, and computes balanced
 * reversal ledger entries in integer BRL cents (M12/M13).
 */
export function evaluateRefundRequest(params: {
  orderId: string;
  capturedAmountCents: number;
  alreadyRefundedCents: number;
  requestedRefundCents: number;
  staffMaxRefundApprovalCents: number;
  actorAal: "aal1" | "aal2";
  reason: string;
}): {
  newPaymentStatus: PaymentStatus;
  totalRefundedAfterCents: number;
  reversalLedgerDebitsCents: number;
  reversalLedgerCreditsCents: number;
} {
  assertIntegerCents(params.capturedAmountCents, "capturedAmountCents");
  assertIntegerCents(params.alreadyRefundedCents, "alreadyRefundedCents");
  assertIntegerCents(params.requestedRefundCents, "requestedRefundCents");

  if (params.requestedRefundCents <= 0) {
    throw new Error("REFUND_INVALID_AMOUNT: Refund amount must be greater than zero cents.");
  }

  if (!params.reason || params.reason.trim().length < 3) {
    throw new Error("REFUND_REASON_REQUIRED: A structured reason is required for all refunds.");
  }

  if (params.actorAal !== "aal2") {
    throw new Error("REFUND_MFA_AAL2_REQUIRED: Multi-factor authentication (aal2) is required to approve refunds.");
  }

  if (params.requestedRefundCents > params.staffMaxRefundApprovalCents) {
    throw new Error(
      `REFUND_ABAC_LIMIT_EXCEEDED: Refund ${params.requestedRefundCents} cents exceeds actor approval ceiling of ${params.staffMaxRefundApprovalCents} cents.`
    );
  }

  const totalRefundedAfterCents = params.alreadyRefundedCents + params.requestedRefundCents;
  if (totalRefundedAfterCents > params.capturedAmountCents) {
    throw new Error(
      `REFUND_EXCEEDS_CAPTURED_AMOUNT: Total refunded (${totalRefundedAfterCents}) would exceed captured amount (${params.capturedAmountCents}).`
    );
  }

  const newPaymentStatus: PaymentStatus =
    totalRefundedAfterCents === params.capturedAmountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";

  return {
    newPaymentStatus,
    totalRefundedAfterCents,
    reversalLedgerDebitsCents: params.requestedRefundCents,
    reversalLedgerCreditsCents: params.requestedRefundCents,
  };
}

export interface AccountDeletionEvaluationInput {
  userId: string;
  hasActiveOrders: boolean;
  hasOpenFinancialDisputes: boolean;
  hasCompletedFiscalTransactions: boolean;
  requestedAt: Date;
}

export interface AccountDeletionEvaluationResult {
  outcome: "IMMEDIATE_ANONYMIZATION" | "RETENTION_HOLD";
  revokeAllSessionsImmediately: boolean;
  holdUntilIso: string | null;
  reasonCode: string;
}

/**
 * Evaluates LGPD account deletion requests against operational and statutory fiscal retention rules (M03).
 */
export function evaluateAccountDeletionRequest(
  input: AccountDeletionEvaluationInput
): AccountDeletionEvaluationResult {
  if (input.hasActiveOrders) {
    const holdUntil = new Date(input.requestedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    return {
      outcome: "RETENTION_HOLD",
      revokeAllSessionsImmediately: true,
      holdUntilIso: holdUntil.toISOString(),
      reasonCode: "ACTIVE_ORDER_IN_PROGRESS",
    };
  }

  if (input.hasOpenFinancialDisputes) {
    const holdUntil = new Date(input.requestedAt.getTime() + 180 * 24 * 60 * 60 * 1000);
    return {
      outcome: "RETENTION_HOLD",
      revokeAllSessionsImmediately: true,
      holdUntilIso: holdUntil.toISOString(),
      reasonCode: "OPEN_FINANCIAL_DISPUTE_OR_CHARGEBACK",
    };
  }

  if (input.hasCompletedFiscalTransactions) {
    // 5-year statutory fiscal/accounting ledger retention; PII is pseudonymized while ledger stays intact
    const holdUntil = new Date(input.requestedAt.getTime() + 5 * 365 * 24 * 60 * 60 * 1000);
    return {
      outcome: "RETENTION_HOLD",
      revokeAllSessionsImmediately: true,
      holdUntilIso: holdUntil.toISOString(),
      reasonCode: "STATUTORY_FISCAL_LEDGER_RETENTION",
    };
  }

  return {
    outcome: "IMMEDIATE_ANONYMIZATION",
    revokeAllSessionsImmediately: true,
    holdUntilIso: null,
    reasonCode: "NO_RETENTION_IMPEDIMENTS",
  };
}

/**
 * Enforces Option 2 Honest Provider Readiness: never simulates external PSP, Maps, or Push success
 * when credentials are not configured.
 */
export function assertExternalProviderReady(params: {
  providerCode: string;
  status: ProviderReadinessStatus;
  missingEnvVars: readonly string[];
}): void {
  if (params.status === "BLOCKED_MISSING_CREDENTIALS" || params.status === "DISABLED") {
    throw new Error(
      `PROVIDER_BLOCKED [${params.providerCode}]: External provider is ${params.status}. Missing credentials: ${params.missingEnvVars.join(", ")}`
    );
  }
}

// ============================================================================
// M07: Partner Store Settings Validation & Bank Account Step-Up Approval Guard
// ============================================================================

/**
 * Validates store settings updates (pause reason, integer minOrderCents, prep time bounds) (M07).
 */
export function validateStoreSettingsPatch(
  patch: StoreSettingsPatchContract
): StoreSettingsPatchContract {
  if (patch.minOrderCents !== undefined) {
    assertIntegerCents(patch.minOrderCents, "minOrderCents");
  }
  if (patch.prepTimeMinMinutes !== undefined) {
    if (!Number.isSafeInteger(patch.prepTimeMinMinutes) || patch.prepTimeMinMinutes <= 0) {
      throw new Error("STORE_SETTINGS_INVALID_PREP_TIME: prepTimeMinMinutes must be > 0.");
    }
  }
  if (patch.prepTimeMaxMinutes !== undefined) {
    const min = patch.prepTimeMinMinutes ?? 1;
    if (!Number.isSafeInteger(patch.prepTimeMaxMinutes) || patch.prepTimeMaxMinutes < min) {
      throw new Error(
        "STORE_SETTINGS_INVALID_PREP_TIME: prepTimeMaxMinutes must be >= prepTimeMinMinutes."
      );
    }
  }
  if (patch.isPaused === true && (!patch.pauseReason || patch.pauseReason.trim().length < 3)) {
    throw new Error(
      "STORE_PAUSE_REASON_REQUIRED: A structured pauseReason is required when pausing a store."
    );
  }
  return patch;
}

/**
 * Creates a PENDING bank account change request requiring step-up MFA (aal2) and compliance approval.
 * Never triggers immediate financial liquidation or stores full raw account numbers (M07/M13).
 */
export function createBankAccountChangeRequest(params: {
  id: string;
  organizationId: string;
  storeId: string;
  requestedBy: string;
  actorAal: "aal1" | "aal2";
  bankCode: string;
  branchNumber: string;
  accountLast4: string;
  reason: string;
  now?: Date;
}): BankAccountChangeRequestContract {
  if (params.actorAal !== "aal2") {
    throw new Error(
      "BANK_CHANGE_MFA_AAL2_REQUIRED: Multi-factor authentication (aal2) is required to request bank account changes."
    );
  }
  if (!/^\d{3,4}$/.test(params.bankCode.trim())) {
    throw new Error("BANK_CHANGE_INVALID_BANK_CODE: bankCode must be 3 to 4 digits.");
  }
  if (!/^\d{4}$/.test(params.accountLast4.trim())) {
    throw new Error(
      "BANK_CHANGE_INVALID_LAST4: Only the last 4 digits of the account may be stored in approval metadata."
    );
  }
  if (!params.reason || params.reason.trim().length < 5) {
    throw new Error("BANK_CHANGE_REASON_REQUIRED: A reason of at least 5 characters is required.");
  }

  return {
    id: params.id,
    organizationId: params.organizationId,
    storeId: params.storeId,
    requestedBy: params.requestedBy,
    bankCode: params.bankCode.trim(),
    branchNumber: params.branchNumber.trim(),
    accountLast4: params.accountLast4.trim(),
    status: "PENDING",
    reason: params.reason.trim(),
    createdAtIso: (params.now ?? new Date()).toISOString(),
  };
}

// ============================================================================
// M08: Restaurant Kitchen Order Queue, SLA Countdown & Reconnect Catch-Up
// ============================================================================

export function mapOrderStatusToKitchenColumn(orderStatus: string): KitchenQueueColumnStatus {
  switch (orderStatus) {
    case "CREATED":
    case "AWAITING_PAYMENT":
    case "PENDING_MERCHANT_ACCEPTANCE":
      return "NEW";
    case "ACCEPTED":
      return "ACCEPTED";
    case "PREPARING":
      return "PREPARING";
    case "READY_FOR_PICKUP":
      return "READY";
    case "DISPATCHING":
    case "COURIER_ASSIGNED":
    case "PICKED_UP":
    case "OUT_FOR_DELIVERY":
    case "ARRIVED_AT_DESTINATION":
      return "IN_TRANSIT";
    case "DELIVERED":
    case "COMPLETED":
      return "COMPLETED";
    case "CANCELLED":
    case "REJECTED":
    case "DELIVERY_FAILED":
    case "DISPUTED":
    case "REFUNDED":
    default:
      return "CANCELLED";
  }
}

/**
 * Builds the real-time kitchen order console queue (M08), computing SLA countdowns from real
 * timestamps and keeping active orders visible even when the store is paused for new orders.
 */
export function buildKitchenOrderQueue(params: {
  storeId: string;
  isStorePaused: boolean;
  orders: readonly OrderRecordContract[];
  prepTimeMaxMinutes?: number;
  acceptanceSlaMinutes?: number;
  now?: Date;
  latestEventCursor?: string | null;
}): StoreOrdersQueueResponseContract {
  const now = params.now ?? new Date();
  const prepTimeMaxMinutes = params.prepTimeMaxMinutes ?? 35;
  const acceptanceSlaMinutes = params.acceptanceSlaMinutes ?? 8;

  const columns: Record<KitchenQueueColumnStatus, KitchenOrderCardContract[]> = {
    NEW: [],
    ACCEPTED: [],
    PREPARING: [],
    READY: [],
    IN_TRANSIT: [],
    COMPLETED: [],
    CANCELLED: [],
  };

  let activeOrderCount = 0;

  for (const order of params.orders) {
    if (order.storeId !== params.storeId) continue;

    const column = mapOrderStatusToKitchenColumn(order.orderStatus);
    const isTerminal = column === "COMPLETED" || column === "CANCELLED";
    if (!isTerminal) {
      activeOrderCount += 1;
    }

    const baseTimeMs =
      column === "NEW"
        ? new Date(order.createdAtIso).getTime()
        : new Date(order.acceptedAtIso ?? order.createdAtIso).getTime();

    const slaWindowMinutes = column === "NEW" ? acceptanceSlaMinutes : prepTimeMaxMinutes;
    const slaDeadlineMs = baseTimeMs + slaWindowMinutes * 60 * 1000;
    const remainingSlaSeconds = isTerminal
      ? 0
      : Math.floor((slaDeadlineMs - now.getTime()) / 1000);

    const card: KitchenOrderCardContract = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      storeId: order.storeId,
      column,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      deliveryStatus: order.deliveryStatus,
      fulfillmentModality: order.fulfillmentModality,
      totalCents: order.totalCents,
      itemsCount: order.itemsSnapshot.reduce((sum, item) => sum + item.quantity, 0),
      customerNotes: order.customerNotes,
      version: order.version,
      createdAtIso: order.createdAtIso,
      slaDeadlineIso: new Date(slaDeadlineMs).toISOString(),
      remainingSlaSeconds,
      isSlaBreached: !isTerminal && remainingSlaSeconds < 0,
    };

    columns[column].push(card);
  }

  return {
    storeId: params.storeId,
    isStorePaused: params.isStorePaused,
    evaluatedAtIso: now.toISOString(),
    activeOrderCount,
    columns,
    latestEventCursor: params.latestEventCursor ?? null,
  };
}

/**
 * Deduplicates incoming order events after a WebSocket/polling reconnect using event IDs and idempotency keys (M08).
 */
export function reconcileKitchenOrderEventsOnReconnect(params: {
  seenEventIds: ReadonlySet<string>;
  incomingEvents: readonly OrderEventRecordContract[];
}): {
  newEvents: OrderEventRecordContract[];
  nextSeenEventIds: Set<string>;
  latestCursor: string | null;
} {
  const nextSeenEventIds = new Set(params.seenEventIds);
  const newEvents: OrderEventRecordContract[] = [];
  let latestCursor: string | null = null;

  for (const evt of params.incomingEvents) {
    latestCursor = evt.id;
    const dedupToken = `${evt.id}:${evt.idempotencyKey}`;
    if (!nextSeenEventIds.has(evt.id) && !nextSeenEventIds.has(dedupToken)) {
      nextSeenEventIds.add(evt.id);
      nextSeenEventIds.add(dedupToken);
      newEvents.push(evt);
    }
  }

  return {
    newEvents,
    nextSeenEventIds,
    latestCursor,
  };
}

// ============================================================================
// M16: Central Administration Governance, Self-Grant Guard & Audit Decisions
// ============================================================================

/**
 * Evaluates a staff role grant request (M16): enforces tech_admin role, MFA aal2,
 * mandatory justification (>= 5 chars), and strictly prohibits self-grant.
 */
export function evaluateStaffScopeGrant(params: {
  actorId: string;
  actorAal: "aal1" | "aal2";
  actorRoles: readonly StaffRole[];
  request: AdminStaffScopeGrantRequestContract;
}): {
  allowed: boolean;
  reasonCode:
    | "ALLOWED"
    | "DENIED_SELF_GRANT_FORBIDDEN"
    | "DENIED_MFA_AAL2_REQUIRED"
    | "DENIED_ROLE_INSUFFICIENT"
    | "DENIED_JUSTIFICATION_REQUIRED";
} {
  if (params.actorId === params.request.targetUserId) {
    return { allowed: false, reasonCode: "DENIED_SELF_GRANT_FORBIDDEN" };
  }
  if (!params.actorRoles.includes("tech_admin")) {
    return { allowed: false, reasonCode: "DENIED_ROLE_INSUFFICIENT" };
  }
  if (params.actorAal !== "aal2") {
    return { allowed: false, reasonCode: "DENIED_MFA_AAL2_REQUIRED" };
  }
  if (!params.request.justification || params.request.justification.trim().length < 5) {
    return { allowed: false, reasonCode: "DENIED_JUSTIFICATION_REQUIRED" };
  }
  assertIntegerCents(params.request.maxRefundApprovalCents, "maxRefundApprovalCents");

  return { allowed: true, reasonCode: "ALLOWED" };
}

/**
 * Evaluates a central admin governance decision (APPROVE, REJECT, NEEDS_INFO, SUSPEND, REIVATE)
 * requiring MFA aal2, authorized staff role, mandatory justification, and non-self target (M16).
 */
export function evaluateAdminGovernanceDecision(params: {
  id: string;
  actorId: string;
  actorAal: "aal1" | "aal2";
  actorRoles: readonly StaffRole[];
  targetType: AdminGovernanceActionContract["targetType"];
  targetId: string;
  decision: AdminGovernanceActionContract["decision"];
  reason: string;
  now?: Date;
}): AdminGovernanceActionContract {
  const allowedRoles: readonly StaffRole[] = [
    "operations",
    "commercial",
    "risk_compliance",
    "tech_admin",
  ];
  if (!params.actorRoles.some((r) => allowedRoles.includes(r))) {
    throw new Error("ADMIN_GOVERNANCE_FORBIDDEN: Actor role cannot execute governance decisions.");
  }
  if (params.actorAal !== "aal2") {
    throw new Error(
      "ADMIN_GOVERNANCE_MFA_AAL2_REQUIRED: Multi-factor authentication (aal2) is required."
    );
  }
  if (params.actorId === params.targetId) {
    throw new Error(
      "ADMIN_GOVERNANCE_SELF_TARGET_FORBIDDEN: Staff members cannot approve or suspend their own account."
    );
  }
  if (!params.reason || params.reason.trim().length < 5) {
    throw new Error(
      "ADMIN_GOVERNANCE_REASON_REQUIRED: A structured reason of at least 5 characters is required."
    );
  }

  return {
    id: params.id,
    targetType: params.targetType,
    targetId: params.targetId,
    decision: params.decision,
    actorId: params.actorId,
    reason: params.reason.trim(),
    createdAtIso: (params.now ?? new Date()).toISOString(),
  };
}

// ============================================================================
// M13: Financial Backoffice, Double-Entry Ledger, PSP Reconciliation & Payouts
// ============================================================================

/**
 * Builds an immutable, balanced double-entry journal for an order capture (M13).
 * Explicitly separates GMV from Net Platform Revenue and segregates Merchant & Courier liabilities.
 */
export function buildBalancedOrderCaptureJournal(params: {
  journalId: string;
  order: OrderRecordContract;
  discountFundedBy: "PLATFORM" | "MERCHANT" | "STORE" | "SHARED" | "NONE";
  platformSubsidyShareBps?: number;
  postedBy: string;
  now?: Date;
}): LedgerJournalPostContract {
  const entries: LedgerJournalEntryLineContract[] = [];

  if (params.order.totalCents > 0) {
    entries.push({
      accountCode: "PSP_CLEARING_RECEIVABLE",
      direction: "DEBIT",
      amountCents: params.order.totalCents,
    });
  }

  const shareBps =
    params.discountFundedBy === "PLATFORM"
      ? 10000
      : params.discountFundedBy === "SHARED"
        ? (params.platformSubsidyShareBps ?? 5000)
        : 0;
  const platformSubsidyCents =
    params.discountFundedBy === "NONE"
      ? 0
      : Math.round((params.order.discountCents * shareBps) / 10000);

  if (platformSubsidyCents > 0) {
    entries.push({
      accountCode: "PLATFORM_PROMO_SUBSIDY_EXPENSE",
      direction: "DEBIT",
      amountCents: platformSubsidyCents,
    });
  }

  if (params.order.merchantNetCents > 0) {
    entries.push({
      accountCode: `MERCHANT_PAYABLE:${params.order.organizationId}`,
      direction: "CREDIT",
      amountCents: params.order.merchantNetCents,
    });
  }

  if (params.order.courierEarningsCents > 0) {
    entries.push({
      accountCode: "COURIER_PAYABLE_POOL",
      direction: "CREDIT",
      amountCents: params.order.courierEarningsCents,
    });
  }

  if (params.order.platformCommissionCents > 0) {
    entries.push({
      accountCode: "PLATFORM_COMMISSION_REVENUE",
      direction: "CREDIT",
      amountCents: params.order.platformCommissionCents,
    });
  }

  if (params.order.serviceFeeCents > 0) {
    entries.push({
      accountCode: "PLATFORM_SERVICE_FEE_REVENUE",
      direction: "CREDIT",
      amountCents: params.order.serviceFeeCents,
    });
  }

  const totalDebitsCents = entries
    .filter((e) => e.direction === "DEBIT")
    .reduce((sum, e) => sum + e.amountCents, 0);
  const totalCreditsCents = entries
    .filter((e) => e.direction === "CREDIT")
    .reduce((sum, e) => sum + e.amountCents, 0);

  if (totalDebitsCents !== totalCreditsCents || totalDebitsCents <= 0) {
    throw new Error(
      `LEDGER_UNBALANCED_JOURNAL: Debits (${totalDebitsCents}) do not equal Credits (${totalCreditsCents}).`
    );
  }

  return {
    id: params.journalId,
    referenceType: "ORDER_CAPTURE",
    referenceId: params.order.id,
    description: `Order #${params.order.orderNumber} capture split posting`,
    idempotencyKey: `jnl_capture_${params.order.id}`,
    postedBy: params.postedBy,
    entries,
    totalDebitsCents,
    totalCreditsCents,
    createdAtIso: (params.now ?? new Date()).toISOString(),
  };
}

/**
 * Reconciles internal captured order totals against PSP settlement records in integer BRL centavos (M13).
 */
export function evaluatePspReconciliationRun(params: {
  runId: string;
  providerCode: string;
  runDate: string;
  expectedOrders: ReadonlyArray<{ orderId: string; totalCents: number }>;
  pspReportedCaptures: ReadonlyArray<{ orderId: string; capturedCents: number }>;
  now?: Date;
}): PspReconciliationRunContract {
  const reportedByOrderId = new Map<string, number>();
  for (const item of params.pspReportedCaptures) {
    reportedByOrderId.set(item.orderId, item.capturedCents);
  }

  let matchedCount = 0;
  const discrepancies: PspReconciliationRunContract["discrepancies"] = [];

  for (const exp of params.expectedOrders) {
    const pspAmount = reportedByOrderId.get(exp.orderId) ?? 0;
    const deltaCents = pspAmount - exp.totalCents;
    if (deltaCents === 0) {
      matchedCount += 1;
    } else {
      discrepancies.push({
        orderId: exp.orderId,
        expectedCents: exp.totalCents,
        pspReportedCents: pspAmount,
        deltaCents,
      });
    }
  }

  const discrepancyTotalCents = discrepancies.reduce(
    (sum, d) => sum + Math.abs(d.deltaCents),
    0
  );

  return {
    id: params.runId,
    providerCode: params.providerCode,
    runDate: params.runDate,
    matchedCount,
    discrepancyCount: discrepancies.length,
    discrepancyTotalCents,
    status: "COMPLETED",
    discrepancies,
    createdAtIso: (params.now ?? new Date()).toISOString(),
  };
}

/**
 * Evaluates settlement payout execution (M13): enforces finance/tech_admin role + MFA aal2,
 * segregation of duties (actor who registered/approved the bank account cannot execute the payout),
 * and honest BLOCKED_NO_PSP status when PSP credentials are not configured.
 */
export function evaluateSettlementPayoutExecution(params: {
  settlement: SettlementRecordContract;
  actorId: string;
  actorAal: "aal1" | "aal2";
  actorRoles: readonly StaffRole[];
  bankAccountApprovedByActorId?: string | null;
  pspProviderStatus: ProviderReadinessStatus;
  externalPayoutReference?: string | null;
}): SettlementRecordContract {
  if (!params.actorRoles.includes("finance") && !params.actorRoles.includes("tech_admin")) {
    throw new Error("SETTLEMENT_FORBIDDEN: Only finance or tech_admin staff can execute payouts.");
  }
  if (params.actorAal !== "aal2") {
    throw new Error("SETTLEMENT_MFA_AAL2_REQUIRED: Multi-factor authentication (aal2) is required.");
  }
  if (
    params.bankAccountApprovedByActorId &&
    params.bankAccountApprovedByActorId === params.actorId
  ) {
    throw new Error(
      "SETTLEMENT_SEGREGATION_OF_DUTIES_VIOLATION: The actor who approved the bank account cannot execute the payout liquidation."
    );
  }

  if (
    params.pspProviderStatus === "BLOCKED_MISSING_CREDENTIALS" ||
    params.pspProviderStatus === "DISABLED"
  ) {
    return {
      ...params.settlement,
      status: "BLOCKED_NO_PSP",
      approvedBy: params.actorId,
      externalPayoutReference: null,
    };
  }

  if (!params.externalPayoutReference || params.externalPayoutReference.trim().length < 4) {
    throw new Error(
      "SETTLEMENT_EXTERNAL_REF_REQUIRED: Confirmed payout requires a verified PSP payout reference."
    );
  }

  return {
    ...params.settlement,
    status: "PAID_CONFIRMED",
    approvedBy: params.actorId,
    externalPayoutReference: params.externalPayoutReference.trim(),
  };
}

// ============================================================================
// M14 & M11: Logistics Dispatch, Offer Acceptance, GPS Validation & POD OTP
// ============================================================================

/**
 * Executes transactional courier offer acceptance (M14/M11):
 * - Rejects if courier is offline, offer is expired, or task already has an active courier (409 conflict).
 * - Reveals the customer's full dropoff address ONLY after the assignment is confirmed.
 */
export function acceptDeliveryOfferTransactional(params: {
  offer: DeliveryOfferContract;
  task: DeliveryTaskContract;
  actorCourierId: string;
  isCourierOnline: boolean;
  fullCustomerAddress: string;
  now?: Date;
}): {
  updatedOffer: DeliveryOfferContract;
  updatedTask: DeliveryTaskContract;
} {
  const now = params.now ?? new Date();
  if (!params.isCourierOnline) {
    throw new Error("COURIER_OFFLINE: Courier must be ONLINE to accept delivery offers.");
  }
  if (params.offer.courierId !== params.actorCourierId) {
    throw new Error("DELIVERY_OFFER_FORBIDDEN: Offer belongs to a different courier.");
  }
  if (params.offer.status !== "OFFERED") {
    throw new Error(`DELIVERY_OFFER_INVALID_STATE: Offer is already ${params.offer.status}.`);
  }
  if (new Date(params.offer.expiresAtIso).getTime() <= now.getTime()) {
    throw new Error(`DELIVERY_OFFER_EXPIRED: Offer expired at ${params.offer.expiresAtIso}.`);
  }
  if (params.task.activeCourierId !== null) {
    throw new Error(
      `DELIVERY_TASK_ALREADY_ASSIGNED: Task ${params.task.id} is already assigned to courier ${params.task.activeCourierId}.`
    );
  }

  const nowIso = now.toISOString();
  const updatedOffer: DeliveryOfferContract = {
    ...params.offer,
    status: "ACCEPTED",
    respondedAtIso: nowIso,
  };

  const updatedTask: DeliveryTaskContract = {
    ...params.task,
    status: "ASSIGNED",
    activeCourierId: params.actorCourierId,
    dropoffFullAddress: params.fullCustomerAddress,
  };

  return { updatedOffer, updatedTask };
}

/**
 * Validates a courier GPS location sample (M14/M11):
 * - Prevents tracking unassigned tasks.
 * - Flags stale timestamps (> 120s) or poor GPS accuracy (> 150m) so uncertain GPS is never treated as sole proof.
 * - Enforces short retention window (24h).
 */
export function evaluateCourierLocationSample(params: {
  sampleId: string;
  courierId: string;
  deliveryTaskId: string | null;
  activeCourierIdForTask: string | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAtIso: string;
  now?: Date;
  maxAgeSeconds?: number;
  maxAccuracyMeters?: number;
}): CourierLocationSampleContract {
  if (
    params.deliveryTaskId !== null &&
    params.activeCourierIdForTask !== params.courierId
  ) {
    throw new Error(
      "DELIVERY_TASK_ACCESS_FORBIDDEN: Courier is not assigned to the specified delivery task."
    );
  }
  if (params.latitude < -90 || params.latitude > 90 || params.longitude < -180 || params.longitude > 180) {
    throw new Error("INVALID_GPS_COORDINATES: Latitude/longitude out of bounds.");
  }

  const now = params.now ?? new Date();
  const recordedMs = new Date(params.recordedAtIso).getTime();
  const ageSeconds = (now.getTime() - recordedMs) / 1000;
  const maxAgeSeconds = params.maxAgeSeconds ?? 120;
  const maxAccuracyMeters = params.maxAccuracyMeters ?? 150;

  const isStaleOrLowAccuracy =
    ageSeconds > maxAgeSeconds || ageSeconds < -30 || params.accuracyMeters > maxAccuracyMeters;

  const expiresAtIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  return {
    id: params.sampleId,
    courierId: params.courierId,
    deliveryTaskId: params.deliveryTaskId,
    latitude: params.latitude,
    longitude: params.longitude,
    accuracyMeters: params.accuracyMeters,
    recordedAtIso: params.recordedAtIso,
    expiresAtIso,
    isStaleOrLowAccuracy,
  };
}

/**
 * Computes SHA-256 hash of a 4-digit delivery confirmation code (M11/M14).
 */
export function hashDeliveryConfirmationCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim(), "utf8").digest("hex");
}

/**
 * Verifies a 4-digit proof-of-delivery confirmation code in constant time (M11/M14).
 */
export function verifyDeliveryConfirmationCode(params: {
  providedCode: string;
  expectedCodeHash: string;
}): boolean {
  if (!/^\d{4}$/.test(params.providedCode.trim())) {
    return false;
  }
  const actualHash = hashDeliveryConfirmationCode(params.providedCode);
  const bufA = Buffer.from(actualHash, "utf8");
  const bufB = Buffer.from(params.expectedCodeHash, "utf8");
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// ============================================================================
// M15: Tenant-Scoped Fleet Operator Portal Guard
// ============================================================================

/**
 * Evaluates fleet manager access to courier and delivery records (M15):
 * - Returns DISABLED_PENDING_FLEET_CONTRACT if the fleet contract is not approved.
 * - Blocks Fleet A manager from viewing independent couriers or couriers belonging to Fleet B.
 */
export function evaluateFleetOperatorAccess(params: {
  fleetOrganizationId: string;
  actorOrganizationIds: readonly string[];
  targetCourierFleetOrgId: string | null;
  isFleetContractApproved: boolean;
}): {
  allowed: boolean;
  reasonCode:
    | "ALLOWED"
    | "DISABLED_PENDING_FLEET_CONTRACT"
    | "DENIED_CROSS_FLEET_OR_INDEPENDENT_COURIER";
} {
  if (!params.isFleetContractApproved) {
    return { allowed: false, reasonCode: "DISABLED_PENDING_FLEET_CONTRACT" };
  }
  if (
    !params.actorOrganizationIds.includes(params.fleetOrganizationId) ||
    params.targetCourierFleetOrgId === null ||
    params.targetCourierFleetOrgId !== params.fleetOrganizationId
  ) {
    return { allowed: false, reasonCode: "DENIED_CROSS_FLEET_OR_INDEPENDENT_COURIER" };
  }
  return { allowed: true, reasonCode: "ALLOWED" };
}

// ============================================================================
// M17: Customer/Partner/Courier Support, SLA, Internal Notes & Refund Thresholds
// ============================================================================

export type SupportCaseStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_CUSTOMER"
  | "WAITING_PARTNER"
  | "AWAITING_ACTION_APPROVAL"
  | "ESCALATED_FINANCE"
  | "ESCALATED_LOGISTICS"
  | "RESOLVED"
  | "CLOSED";

export type SupportPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL_IN_ROUTE";

export type SupportRequesterRole = "CUSTOMER" | "PARTNER" | "COURIER";

export type SupportActionType = "PARTIAL_REFUND" | "FULL_REFUND" | "COURIER_COMPENSATION";

export interface SupportCaseContract {
  id: string;
  caseNumber: number;
  orderId: string | null;
  deliveryTaskId: string | null;
  organizationId: string | null;
  storeId: string | null;
  requesterId: string;
  requesterRole: SupportRequesterRole;
  assignedStaffId: string | null;
  category: string;
  priority: SupportPriority;
  status: SupportCaseStatus;
  subject: string;
  slaDueAtIso: string;
  resolvedAtIso: string | null;
  createdAtIso: string;
  updatedAtIso: string;
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
  actionType: SupportActionType;
  amountCents: number;
  reason: string;
  status: "PENDING_FINANCE" | "APPROVED" | "REJECTED";
  decidedBy: string | null;
  decidedAtIso: string | null;
  decisionNotes: string | null;
  createdAtIso: string;
}

const SUPPORT_CASE_TRANSITIONS: Record<SupportCaseStatus, readonly SupportCaseStatus[]> = {
  OPEN: [
    "IN_PROGRESS",
    "WAITING_CUSTOMER",
    "WAITING_PARTNER",
    "AWAITING_ACTION_APPROVAL",
    "ESCALATED_FINANCE",
    "ESCALATED_LOGISTICS",
    "RESOLVED",
  ],
  IN_PROGRESS: [
    "WAITING_CUSTOMER",
    "WAITING_PARTNER",
    "AWAITING_ACTION_APPROVAL",
    "ESCALATED_FINANCE",
    "ESCALATED_LOGISTICS",
    "RESOLVED",
  ],
  WAITING_CUSTOMER: [
    "IN_PROGRESS",
    "ESCALATED_FINANCE",
    "ESCALATED_LOGISTICS",
    "RESOLVED",
    "CLOSED",
  ],
  WAITING_PARTNER: [
    "IN_PROGRESS",
    "ESCALATED_FINANCE",
    "ESCALATED_LOGISTICS",
    "RESOLVED",
    "CLOSED",
  ],
  AWAITING_ACTION_APPROVAL: [
    "IN_PROGRESS",
    "ESCALATED_FINANCE",
    "RESOLVED",
  ],
  ESCALATED_FINANCE: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  ESCALATED_LOGISTICS: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"],
  CLOSED: [],
};

/**
 * Computes the deterministic SLA deadline (`slaDueAtIso`) based on ticket priority and category (M17).
 */
export function computeSupportSlaDueAt(params: {
  priority: SupportPriority;
  category: string;
  createdAt?: Date;
}): {
  slaMinutes: number;
  slaDueAtIso: string;
  effectivePriority: SupportPriority;
} {
  const createdAt = params.createdAt ?? new Date();
  const normalizedCategory = params.category.trim().toUpperCase();

  let effectivePriority: SupportPriority = params.priority;
  if (normalizedCategory === "ROUTE_INCIDENT" || normalizedCategory === "ACCIDENT_IN_ROUTE") {
    effectivePriority = "CRITICAL_IN_ROUTE";
  } else if (
    (normalizedCategory === "MISSING_ITEM" || normalizedCategory === "INCORRECT_CHARGE") &&
    effectivePriority === "LOW"
  ) {
    effectivePriority = "HIGH";
  }

  const slaMinutesByPriority: Record<SupportPriority, number> = {
    CRITICAL_IN_ROUTE: 15,
    HIGH: 60,
    MEDIUM: 240,
    LOW: 1440,
  };

  const slaMinutes = slaMinutesByPriority[effectivePriority];
  const slaDueAtIso = new Date(createdAt.getTime() + slaMinutes * 60 * 1000).toISOString();

  return {
    slaMinutes,
    slaDueAtIso,
    effectivePriority,
  };
}

/**
 * Validates and executes a support case status transition (M17).
 */
export function transitionSupportCaseStatus(params: {
  supportCase: SupportCaseContract;
  targetStatus: SupportCaseStatus;
  assignedStaffId?: string | null;
  now?: Date;
}): SupportCaseContract {
  const allowed = SUPPORT_CASE_TRANSITIONS[params.supportCase.status] ?? [];
  if (!allowed.includes(params.targetStatus)) {
    throw new Error(
      `SUPPORT_CASE_INVALID_TRANSITION: Cannot transition support case from ${params.supportCase.status} to ${params.targetStatus}.`
    );
  }
  const nowIso = (params.now ?? new Date()).toISOString();
  return {
    ...params.supportCase,
    status: params.targetStatus,
    assignedStaffId:
      params.assignedStaffId !== undefined
        ? params.assignedStaffId
        : params.supportCase.assignedStaffId,
    resolvedAtIso:
      params.targetStatus === "RESOLVED" ? nowIso : params.supportCase.resolvedAtIso,
    updatedAtIso: nowIso,
  };
}

/**
 * Strips internal staff notes (`isInternalNote === true`), internal-only attachments,
 * and internal finance action requests when returning a support case to a non-staff actor (M17).
 */
export function filterSupportCaseViewForActor(params: {
  supportCase: SupportCaseContract;
  messages: readonly SupportMessageContract[];
  attachments: readonly SupportAttachmentContract[];
  actionRequests: readonly SupportActionRequestContract[];
  isStaffActor: boolean;
}): {
  supportCase: SupportCaseContract;
  messages: SupportMessageContract[];
  attachments: SupportAttachmentContract[];
  actionRequests: SupportActionRequestContract[];
} {
  if (params.isStaffActor) {
    return {
      supportCase: params.supportCase,
      messages: [...params.messages],
      attachments: [...params.attachments],
      actionRequests: [...params.actionRequests],
    };
  }

  const internalMessageIds = new Set(
    params.messages.filter((m) => m.isInternalNote).map((m) => m.id)
  );

  return {
    supportCase: params.supportCase,
    messages: params.messages.filter((m) => !m.isInternalNote),
    attachments: params.attachments.filter(
      (a) => !a.isInternalOnly && (a.messageId === null || !internalMessageIds.has(a.messageId))
    ),
    actionRequests: [],
  };
}

/**
 * Evaluates a support refund/compensation action request against the platform's automatic
 * support threshold (`autoApproveLimitCents`). Requests within threshold auto-approve;
 * requests exceeding threshold escalate to `PENDING_FINANCE` (`ESCALATED_FINANCE`) (M17).
 */
export function evaluateSupportActionRequest(params: {
  id: string;
  caseId: string;
  orderId: string;
  requestedByStaffId: string;
  actionType: SupportActionType;
  amountCents: number;
  orderCapturedCents: number;
  alreadyRefundedCents: number;
  autoApproveLimitCents: number;
  reason: string;
  now?: Date;
}): {
  actionRequest: SupportActionRequestContract;
  autoApproved: boolean;
  nextCaseStatus: SupportCaseStatus;
} {
  assertIntegerCents(params.amountCents, "amountCents");
  assertIntegerCents(params.orderCapturedCents, "orderCapturedCents");
  assertIntegerCents(params.alreadyRefundedCents, "alreadyRefundedCents");
  assertIntegerCents(params.autoApproveLimitCents, "autoApproveLimitCents");

  if (params.amountCents <= 0) {
    throw new Error("SUPPORT_ACTION_INVALID_AMOUNT: amountCents must be > 0.");
  }
  if (!params.reason || params.reason.trim().length < 5) {
    throw new Error("SUPPORT_ACTION_REASON_REQUIRED: A reason of at least 5 characters is required.");
  }
  if (
    (params.actionType === "PARTIAL_REFUND" || params.actionType === "FULL_REFUND") &&
    params.alreadyRefundedCents + params.amountCents > params.orderCapturedCents
  ) {
    throw new Error(
      `SUPPORT_REFUND_EXCEEDS_CAPTURED: Requested ${params.amountCents} + already refunded ${params.alreadyRefundedCents} exceeds captured ${params.orderCapturedCents} cents.`
    );
  }

  const nowIso = (params.now ?? new Date()).toISOString();
  const autoApproved = params.amountCents <= params.autoApproveLimitCents;

  return {
    actionRequest: {
      id: params.id,
      caseId: params.caseId,
      orderId: params.orderId,
      requestedBy: params.requestedByStaffId,
      actionType: params.actionType,
      amountCents: params.amountCents,
      reason: params.reason.trim(),
      status: autoApproved ? "APPROVED" : "PENDING_FINANCE",
      decidedBy: autoApproved ? params.requestedByStaffId : null,
      decidedAtIso: autoApproved ? nowIso : null,
      decisionNotes: autoApproved
        ? `Auto-approved within support threshold (${params.autoApproveLimitCents} cents).`
        : null,
      createdAtIso: nowIso,
    },
    autoApproved,
    nextCaseStatus: autoApproved ? "RESOLVED" : "ESCALATED_FINANCE",
  };
}

/**
 * Approves or rejects an escalated `PENDING_FINANCE` support action request, enforcing
 * `finance`/`tech_admin` role, `aal2` MFA, and Segregation of Duties (M17/M13).
 */
export function decideEscalatedSupportActionRequest(params: {
  request: SupportActionRequestContract;
  decision: "APPROVED" | "REJECTED";
  decidedByStaffId: string;
  actorStaffRoles: readonly string[];
  actorAal: "aal1" | "aal2";
  decisionNotes: string;
  now?: Date;
}): SupportActionRequestContract {
  if (params.actorAal !== "aal2") {
    throw new Error(
      "SUPPORT_FINANCE_MFA_AAL2_REQUIRED: Multi-factor authentication (aal2) is required to decide escalated support refunds."
    );
  }
  const hasFinanceAuthority = params.actorStaffRoles.some(
    (r) => r === "finance" || r === "tech_admin"
  );
  if (!hasFinanceAuthority) {
    throw new Error(
      "SUPPORT_FINANCE_ROLE_REQUIRED: Only finance or tech_admin staff can decide escalated support action requests."
    );
  }
  if (params.request.status !== "PENDING_FINANCE") {
    throw new Error(
      `SUPPORT_ACTION_ALREADY_DECIDED: Action request ${params.request.id} is already ${params.request.status}.`
    );
  }
  if (params.decidedByStaffId === params.request.requestedBy) {
    throw new Error(
      "SEGREGATION_OF_DUTIES_VIOLATION: The staff member who requested the escalated refund cannot approve their own request."
    );
  }
  if (!params.decisionNotes || params.decisionNotes.trim().length < 5) {
    throw new Error("SUPPORT_DECISION_NOTES_REQUIRED: Decision notes of at least 5 characters are required.");
  }

  const nowIso = (params.now ?? new Date()).toISOString();
  return {
    ...params.request,
    status: params.decision,
    decidedBy: params.decidedByStaffId,
    decidedAtIso: nowIso,
    decisionNotes: params.decisionNotes.trim(),
  };
}

// ============================================================================
// M18: Comercial, Leads, Propostas, Contratos Versionados e Onboarding (Fase O)
// ============================================================================

const COMMERCIAL_LEAD_TRANSITIONS: Record<
  CommercialLeadStatus,
  readonly CommercialLeadStatus[]
> = {
  NEW: ["QUALIFYING", "PROPOSAL_SENT", "LOST", "ARCHIVED"],
  QUALIFYING: ["PROPOSAL_SENT", "NEGOTIATION", "LOST", "ARCHIVED"],
  PROPOSAL_SENT: ["NEGOTIATION", "CONVERTED", "LOST", "ARCHIVED"],
  NEGOTIATION: ["PROPOSAL_SENT", "CONVERTED", "LOST", "ARCHIVED"],
  CONVERTED: ["ARCHIVED"],
  LOST: ["QUALIFYING", "ARCHIVED"],
  ARCHIVED: ["QUALIFYING"],
};

/**
 * Transitions a commercial lead (`commercial_leads`) through its pipeline state machine (M18).
 */
export function transitionCommercialLeadStatus(params: {
  lead: CommercialLeadContract;
  targetStatus: CommercialLeadStatus;
  convertedOrganizationId?: string | null;
  notes?: string | null;
  now?: Date;
}): CommercialLeadContract {
  const allowed = COMMERCIAL_LEAD_TRANSITIONS[params.lead.status] ?? [];
  if (!allowed.includes(params.targetStatus)) {
    throw new Error(
      `COMMERCIAL_LEAD_INVALID_TRANSITION: Cannot transition lead ${params.lead.id} from ${params.lead.status} to ${params.targetStatus}.`
    );
  }
  if (
    params.targetStatus === "CONVERTED" &&
    !params.convertedOrganizationId &&
    !params.lead.convertedOrganizationId
  ) {
    throw new Error(
      "COMMERCIAL_LEAD_ORGANIZATION_REQUIRED: convertedOrganizationId is required when transitioning lead to CONVERTED."
    );
  }

  const nowIso = (params.now ?? new Date()).toISOString();
  return {
    ...params.lead,
    status: params.targetStatus,
    convertedOrganizationId:
      params.convertedOrganizationId !== undefined
        ? params.convertedOrganizationId
        : params.lead.convertedOrganizationId,
    notes: params.notes !== undefined ? params.notes : params.lead.notes,
    updatedAtIso: nowIso,
  };
}

/**
 * Validates basis-point boundaries and payout cycles and constructs a versioned
 * commercial proposal (`commercial_proposals`) (M18).
 */
export function validateAndBuildCommercialProposal(params: {
  id: string;
  leadId: string;
  organizationId?: string | null;
  proposalVersion: number;
  platformDeliveryCommissionBps: number;
  merchantDeliveryCommissionBps: number;
  pickupCommissionBps: number;
  serviceFeeBps: number;
  payoutCycleDays: 1 | 7 | 14 | 30;
  legalTemplateStatus?: "PENDING_LEGAL_REVIEW" | "APPROVED_TEMPLATE";
  notes?: string | null;
  status?: CommercialProposalStatus;
  validUntilIso: string;
  proposedByStaffId: string;
  now?: Date;
}): CommercialProposalContract {
  if (!Number.isInteger(params.proposalVersion) || params.proposalVersion < 1) {
    throw new Error("COMMERCIAL_PROPOSAL_INVALID_NUMBER: proposalVersion must be an integer >= 1.");
  }

  const bpsFields: Array<[string, number, number]> = [
    ["platformDeliveryCommissionBps", params.platformDeliveryCommissionBps, 5000],
    ["merchantDeliveryCommissionBps", params.merchantDeliveryCommissionBps, 5000],
    ["pickupCommissionBps", params.pickupCommissionBps, 5000],
    ["serviceFeeBps", params.serviceFeeBps, 2000],
  ];
  for (const [name, value, max] of bpsFields) {
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new Error(
        `COMMERCIAL_PROPOSAL_INVALID_BPS: ${name} must be an integer between 0 and ${max} bps.`
      );
    }
  }

  if (![1, 7, 14, 30].includes(params.payoutCycleDays)) {
    throw new Error(
      "COMMERCIAL_PROPOSAL_INVALID_PAYOUT_CYCLE: payoutCycleDays must be one of 1, 7, 14, or 30."
    );
  }
  if (!params.validUntilIso) {
    throw new Error("COMMERCIAL_PROPOSAL_VALID_UNTIL_REQUIRED: validUntilIso is required.");
  }

  const nowIso = (params.now ?? new Date()).toISOString();
  return {
    id: params.id,
    leadId: params.leadId,
    organizationId: params.organizationId ?? null,
    proposalVersion: params.proposalVersion,
    platformDeliveryCommissionBps: params.platformDeliveryCommissionBps,
    merchantDeliveryCommissionBps: params.merchantDeliveryCommissionBps,
    pickupCommissionBps: params.pickupCommissionBps,
    serviceFeeBps: params.serviceFeeBps,
    payoutCycleDays: params.payoutCycleDays,
    legalTemplateStatus: params.legalTemplateStatus ?? "PENDING_LEGAL_REVIEW",
    status: params.status ?? "SENT",
    proposedByStaffId: params.proposedByStaffId,
    validUntilIso: params.validUntilIso,
    notes: params.notes !== undefined ? params.notes : null,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  };
}

/**
 * Builds a versioned `MerchantContractRecordContract` and `CommissionRuleVersionContract`
 * from an accepted/converted commercial proposal (M18).
 */
export function buildVersionedContractAndCommissionRule(params: {
  proposal: CommercialProposalContract;
  organizationId: string;
  contractId: string;
  commissionRuleId: string;
  previousContractVersion?: number;
  createdByStaffId: string;
  effectiveFromIso?: string;
  now?: Date;
}): {
  updatedProposal: CommercialProposalContract;
  contract: MerchantContractRecordContract;
  commissionRule: CommissionRuleVersionContract;
} {
  if (params.proposal.status === "REJECTED" || params.proposal.status === "EXPIRED") {
    throw new Error(
      `COMMERCIAL_PROPOSAL_CANNOT_CONVERT: Proposal ${params.proposal.id} has status ${params.proposal.status}.`
    );
  }

  const nowIso = (params.now ?? new Date()).toISOString();
  const effectiveFromIso = params.effectiveFromIso ?? nowIso;
  const nextVersion = (params.previousContractVersion ?? 0) + 1;

  const contract: MerchantContractRecordContract = {
    id: params.contractId,
    organizationId: params.organizationId,
    versionNumber: nextVersion,
    platformDeliveryCommissionBps: params.proposal.platformDeliveryCommissionBps,
    merchantDeliveryCommissionBps: params.proposal.merchantDeliveryCommissionBps,
    pickupCommissionBps: params.proposal.pickupCommissionBps,
    serviceFeeBps: params.proposal.serviceFeeBps,
    payoutCycleDays: params.proposal.payoutCycleDays,
    legalTemplateStatus: params.proposal.legalTemplateStatus,
    effectiveFromIso,
    effectiveUntilIso: null,
    approvedBy: params.createdByStaffId,
    acceptedByPartnerOwnerId: null,
    acceptedAtIso: null,
    createdAtIso: nowIso,
  };

  const commissionRule: CommissionRuleVersionContract = {
    id: params.commissionRuleId,
    organizationId: params.organizationId,
    contractId: params.contractId,
    versionNumber: nextVersion,
    platformDeliveryCommissionBps: params.proposal.platformDeliveryCommissionBps,
    merchantDeliveryCommissionBps: params.proposal.merchantDeliveryCommissionBps,
    pickupCommissionBps: params.proposal.pickupCommissionBps,
    serviceFeeBps: params.proposal.serviceFeeBps,
    effectiveFromIso,
    effectiveUntilIso: null,
    createdByStaffId: params.createdByStaffId,
    createdAtIso: nowIso,
  };

  const updatedProposal: CommercialProposalContract = {
    ...params.proposal,
    organizationId: params.organizationId,
    status: "ACCEPTED",
    updatedAtIso: nowIso,
  };

  return {
    updatedProposal,
    contract,
    commissionRule,
  };
}

/**
 * Verifies that only a `partner_owner` of the contract's organization can formally accept
 * the versioned merchant contract (`merchant_contracts`) (M18).
 */
export function evaluatePartnerContractAcceptance(params: {
  contract: MerchantContractRecordContract;
  actorId: string;
  actorOrganizationMemberships: ReadonlyArray<{
    organizationId: string;
    role: string;
  }>;
  now?: Date;
}): MerchantContractRecordContract {
  const isOwner = params.actorOrganizationMemberships.some(
    (m) => m.organizationId === params.contract.organizationId && m.role === "partner_owner"
  );
  if (!isOwner) {
    throw new Error(
      `PARTNER_OWNER_REQUIRED_FOR_CONTRACT_ACCEPTANCE: Actor ${params.actorId} is not a partner_owner of organization ${params.contract.organizationId}.`
    );
  }
  if (params.contract.effectiveUntilIso !== null) {
    throw new Error(
      `CONTRACT_NOT_ACCEPTABLE: Contract ${params.contract.id} is already superseded.`
    );
  }

  const nowIso = (params.now ?? new Date()).toISOString();
  return {
    ...params.contract,
    acceptedByPartnerOwnerId: params.actorId,
    acceptedAtIso: nowIso,
  };
}

/**
 * Enforces strict RBAC segregation between `commercial` staff and financial operations (M18/M13).
 * A staff actor with `commercial` role (and without `finance` or `tech_admin`) is forbidden from
 * executing settlements, approving bank account changes, or deciding financial refunds.
 */
export function assertCommercialSegregationFromFinance(params: {
  actorStaffRoles: readonly string[];
  operation: "SETTLEMENT_EXECUTION" | "BANK_ACCOUNT_GOVERNANCE" | "FINANCE_REFUND_APPROVAL";
}): void {
  const hasFinanceOrTechAdmin = params.actorStaffRoles.some(
    (r) => r === "finance" || r === "tech_admin"
  );
  if (!hasFinanceOrTechAdmin) {
    throw new Error(
      `COMMERCIAL_FINANCE_SEGREGATION_VIOLATION: Staff with roles [${params.actorStaffRoles.join(", ")}] cannot perform ${params.operation}.`
    );
  }
}

// ============================================================================
// M19: Marketing, Promotions, Atomic Budget Guard & Verified Reviews (Fase P)
// ============================================================================

export interface PromotionEvaluationResult {
  eligible: boolean;
  reasonCode: string;
  discountCents: number;
  platformSubsidyCents: number;
  merchantSubsidyCents: number;
  fundedBy: PromotionFundedBy;
  platformShareBps: number;
}

/**
 * Evaluates coupon eligibility (store scope, validity window, min order, first-order-only,
 * per-user cap, and remaining campaign budget) and computes the exact subsidy split
 * (`PLATFORM`, `STORE`/`MERCHANT`, or `SHARED`) in integer BRL cents (M19).
 */
export function evaluatePromotionEligibilityAndSubsidy(params: {
  promotion: PromotionCampaignContract;
  storeId: string;
  grossMerchandiseCents: number;
  customerPriorOrdersCount: number;
  customerPriorRedemptionsForPromo: number;
  now?: Date;
}): PromotionEvaluationResult {
  assertIntegerCents(params.grossMerchandiseCents, "grossMerchandiseCents");
  const now = params.now ?? new Date();
  const promo = params.promotion;

  const fail = (reasonCode: string): PromotionEvaluationResult => ({
    eligible: false,
    reasonCode,
    discountCents: 0,
    platformSubsidyCents: 0,
    merchantSubsidyCents: 0,
    fundedBy: promo.fundedBy,
    platformShareBps: promo.platformShareBps,
  });

  if (!promo.isActive) {
    return fail("PROMO_INACTIVE");
  }
  const nowMs = now.getTime();
  if (nowMs < new Date(promo.startsAtIso).getTime() || nowMs > new Date(promo.endsAtIso).getTime()) {
    return fail("PROMO_OUTSIDE_VALIDITY_WINDOW");
  }
  if (promo.storeId !== null && promo.storeId !== params.storeId) {
    return fail("PROMO_STORE_MISMATCH");
  }
  if (params.grossMerchandiseCents < promo.minOrderCents) {
    return fail("PROMO_BELOW_MIN_ORDER");
  }
  if (promo.firstOrderOnly && params.customerPriorOrdersCount > 0) {
    return fail("PROMO_FIRST_ORDER_ONLY");
  }
  if (params.customerPriorRedemptionsForPromo >= promo.maxUsesPerUser) {
    return fail("PROMO_USER_LIMIT_EXCEEDED");
  }

  const rawDiscountCents =
    promo.discountType === "FIXED_CENTS"
      ? promo.discountValue
      : Math.round((params.grossMerchandiseCents * promo.discountValue) / 10000);
  const discountCents = Math.min(
    rawDiscountCents,
    promo.maxDiscountCents,
    params.grossMerchandiseCents
  );

  if (discountCents <= 0) {
    return fail("PROMO_ZERO_DISCOUNT");
  }
  if (promo.budgetConsumedCents + discountCents > promo.budgetLimitCents) {
    return fail("PROMO_BUDGET_EXHAUSTED");
  }

  const shareBps =
    promo.fundedBy === "PLATFORM"
      ? 10000
      : promo.fundedBy === "SHARED"
        ? promo.platformShareBps
        : 0;
  const platformSubsidyCents = Math.round((discountCents * shareBps) / 10000);
  const merchantSubsidyCents = discountCents - platformSubsidyCents;

  return {
    eligible: true,
    reasonCode: "PROMO_ELIGIBLE",
    discountCents,
    platformSubsidyCents,
    merchantSubsidyCents,
    fundedBy: promo.fundedBy,
    platformShareBps: shareBps,
  };
}

/**
 * Validates and creates a verified customer order review (M19).
 * Only the customer who owns a `DELIVERED` or `COMPLETED` order can submit a review,
 * and at most 1 review per order is allowed.
 */
export function evaluateVerifiedOrderReviewCreation(params: {
  id: string;
  order: OrderRecordContract;
  actorCustomerId: string;
  existingReviewForOrder: OrderReviewContract | null;
  rating: number;
  comment?: string | null;
  now?: Date;
}): OrderReviewContract {
  if (params.order.customerId !== params.actorCustomerId) {
    throw new Error(
      `REVIEW_NOT_ORDER_OWNER: Customer ${params.actorCustomerId} does not own order ${params.order.id}.`
    );
  }
  if (params.order.orderStatus !== "DELIVERED" && params.order.orderStatus !== "COMPLETED") {
    throw new Error(
      `REVIEW_ORDER_NOT_DELIVERED: Order ${params.order.id} is in status ${params.order.orderStatus}; only DELIVERED or COMPLETED orders can be reviewed.`
    );
  }
  if (params.existingReviewForOrder !== null) {
    throw new Error(
      `REVIEW_ALREADY_SUBMITTED: Order ${params.order.id} already has a verified review.`
    );
  }
  if (!Number.isInteger(params.rating) || params.rating < 1 || params.rating > 5) {
    throw new Error("REVIEW_INVALID_RATING: rating must be an integer between 1 and 5.");
  }

  const nowIso = (params.now ?? new Date()).toISOString();
  return {
    id: params.id,
    orderId: params.order.id,
    storeId: params.order.storeId,
    customerId: params.actorCustomerId,
    rating: params.rating,
    comment: params.comment && params.comment.trim().length > 0 ? params.comment.trim() : null,
    partnerReply: null,
    partnerRepliedAtIso: null,
    moderationStatus: "PUBLISHED",
    moderatedBy: null,
    moderatedAtIso: null,
    moderationReason: null,
    createdAtIso: nowIso,
  };
}

/**
 * Records a partner's official reply to a verified customer review without altering
 * the customer's rating or original comment (M19).
 */
export function evaluatePartnerReviewReply(params: {
  review: OrderReviewContract;
  replyText: string;
  now?: Date;
}): OrderReviewContract {
  if (!params.replyText || params.replyText.trim().length < 3) {
    throw new Error("REVIEW_REPLY_TOO_SHORT: Partner reply must be at least 3 characters.");
  }
  const nowIso = (params.now ?? new Date()).toISOString();
  return {
    ...params.review,
    partnerReply: params.replyText.trim(),
    partnerRepliedAtIso: nowIso,
  };
}

/**
 * Moderates a verified customer review (M19). Requires authorized staff role and
 * mandatory justification (`>= 10` characters). Never mutates the customer's original rating or comment.
 */
export function evaluateAdminReviewModeration(params: {
  review: OrderReviewContract;
  targetModerationStatus: "PUBLISHED" | "HIDDEN_BY_MODERATION";
  moderatorStaffId: string;
  actorStaffRoles: readonly string[];
  moderationReason: string;
  now?: Date;
}): OrderReviewContract {
  const allowedRoles = new Set([
    "marketing",
    "growth_marketing",
    "support",
    "operations",
    "risk_compliance",
    "tech_admin",
  ]);
  const isAuthorized = params.actorStaffRoles.some((r) => allowedRoles.has(r));
  if (!isAuthorized) {
    throw new Error(
      "REVIEW_MODERATION_FORBIDDEN: Staff role is not authorized to moderate order reviews."
    );
  }
  if (!params.moderationReason || params.moderationReason.trim().length < 10) {
    throw new Error(
      "REVIEW_MODERATION_REASON_REQUIRED: A moderation justification of at least 10 characters is required."
    );
  }

  const nowIso = (params.now ?? new Date()).toISOString();
  return {
    ...params.review,
    moderationStatus: params.targetModerationStatus,
    moderatedBy: params.moderatorStaffId,
    moderatedAtIso: nowIso,
    moderationReason: params.moderationReason.trim(),
  };
}

/**
 * Computes a store's real average rating and published review count from verified reviews (M19).
 */
export function calculatePublishedStoreRatingSummary(
  reviews: readonly OrderReviewContract[]
): {
  publishedReviewsCount: number;
  averageRating: number;
} {
  const published = reviews.filter((r) => r.moderationStatus === "PUBLISHED");
  if (published.length === 0) {
    return { publishedReviewsCount: 0, averageRating: 0 };
  }
  const sum = published.reduce((acc, r) => acc + r.rating, 0);
  return {
    publishedReviewsCount: published.length,
    averageRating: Math.round((sum / published.length) * 100) / 100,
  };
}

// ============================================================================
// M20: Transactional Outbox Backoff, Versioned Notification Templates (en/pt-BR),
// Channel Eligibility, Device Revocation Guard, Realtime Cursor Recovery & Webhooks (Fase Q)
// ============================================================================

/**
 * Calculates exponential backoff in milliseconds bounded by `maxMs` for outbox retries (M20).
 */
export function calculateOutboxBackoffMs(
  attempts: number,
  baseMs = 1000,
  maxMs = 60000
): number {
  const safeAttempts = Math.max(1, Math.floor(attempts));
  return Math.min(baseMs * Math.pow(2, safeAttempts - 1), maxMs);
}

interface VersionedTemplateEntry {
  templateKey: string;
  version: number;
  category: NotificationCategory;
  en: { title: string; body: string };
  "pt-BR": { title: string; body: string };
}

const VERSIONED_NOTIFICATION_TEMPLATES_V1: Record<string, VersionedTemplateEntry> = {
  "order.created": {
    templateKey: "order.created",
    version: 1,
    category: "TRANSACTIONAL",
    en: {
      title: "Order #{orderNumber} created",
      body: "Your order #{orderNumber} at {storeName} was received and is awaiting confirmation.",
    },
    "pt-BR": {
      title: "Pedido #{orderNumber} criado",
      body: "Seu pedido #{orderNumber} em {storeName} foi recebido e aguarda confirmação.",
    },
  },
  "order.status_changed": {
    templateKey: "order.status_changed",
    version: 1,
    category: "TRANSACTIONAL",
    en: {
      title: "Order #{orderNumber} status updated: {status}",
      body: "Your order #{orderNumber} at {storeName} is now in status {status}.",
    },
    "pt-BR": {
      title: "Status do Pedido #{orderNumber} atualizado: {status}",
      body: "Seu pedido #{orderNumber} em {storeName} agora está em status {status}.",
    },
  },
  "payment.captured": {
    templateKey: "payment.captured",
    version: 1,
    category: "TRANSACTIONAL",
    en: {
      title: "Payment confirmed for Order #{orderNumber}",
      body: "Your payment of {amount} for order #{orderNumber} was captured.",
    },
    "pt-BR": {
      title: "Pagamento confirmado para o Pedido #{orderNumber}",
      body: "Seu pagamento de {amount} referente ao pedido #{orderNumber} foi capturado.",
    },
  },
  "payment.refunded": {
    templateKey: "payment.refunded",
    version: 1,
    category: "TRANSACTIONAL",
    en: {
      title: "Refund processed for Order #{orderNumber}",
      body: "A refund of {amount} was processed for order #{orderNumber}.",
    },
    "pt-BR": {
      title: "Reembolso processado para o Pedido #{orderNumber}",
      body: "Um reembolso de {amount} foi processado para o pedido #{orderNumber}.",
    },
  },
  "delivery.offer_created": {
    templateKey: "delivery.offer_created",
    version: 1,
    category: "TRANSACTIONAL",
    en: {
      title: "New delivery offer available",
      body: "Pickup at {storeName} ({distance}m). Accept in the Courier app to view full dropoff address.",
    },
    "pt-BR": {
      title: "Nova oferta de entrega disponível",
      body: "Coleta em {storeName} ({distance}m). Aceite no app Entregador para visualizar o endereço completo.",
    },
  },
  "delivery.assigned": {
    templateKey: "delivery.assigned",
    version: 1,
    category: "TRANSACTIONAL",
    en: {
      title: "Courier assigned — Order #{orderNumber}",
      body: "A courier has been assigned to deliver order #{orderNumber}.",
    },
    "pt-BR": {
      title: "Entregador atribuído — Pedido #{orderNumber}",
      body: "Um entregador foi designado para a entrega do pedido #{orderNumber}.",
    },
  },
  "delivery.completed": {
    templateKey: "delivery.completed",
    version: 1,
    category: "TRANSACTIONAL",
    en: {
      title: "Order #{orderNumber} delivered",
      body: "Your order #{orderNumber} was delivered with verified handoff confirmation.",
    },
    "pt-BR": {
      title: "Pedido #{orderNumber} entregue",
      body: "Seu pedido #{orderNumber} foi entregue com confirmação verificada.",
    },
  },
  "support.case_updated": {
    templateKey: "support.case_updated",
    version: 1,
    category: "TRANSACTIONAL",
    en: {
      title: "Support Case #{caseNumber} updated",
      body: "Support case #{caseNumber} is now in status {status}.",
    },
    "pt-BR": {
      title: "Chamado de Suporte #{caseNumber} atualizado",
      body: "O chamado de suporte #{caseNumber} agora está em status {status}.",
    },
  },
  "payout.settled": {
    templateKey: "payout.settled",
    version: 1,
    category: "TRANSACTIONAL",
    en: {
      title: "Settlement #{settlementId} updated",
      body: "Settlement #{settlementId} ({amount}) is now {status}.",
    },
    "pt-BR": {
      title: "Repasse #{settlementId} atualizado",
      body: "O repasse #{settlementId} ({amount}) agora está em status {status}.",
    },
  },
  "security.device_revoked": {
    templateKey: "security.device_revoked",
    version: 1,
    category: "SECURITY",
    en: {
      title: "Security Alert: Device session revoked",
      body: "Device {deviceIdentifier} was revoked from your account.",
    },
    "pt-BR": {
      title: "Alerta de Segurança: Sessão de dispositivo revogada",
      body: "O dispositivo {deviceIdentifier} foi revogado da sua conta.",
    },
  },
  "marketing.promo": {
    templateKey: "marketing.promo",
    version: 1,
    category: "MARKETING",
    en: {
      title: "Special Offer: Coupon {promoCode}",
      body: "Use coupon {promoCode} on your next eligible order.",
    },
    "pt-BR": {
      title: "Oferta Especial: Cupom {promoCode}",
      body: "Use o cupom {promoCode} no seu próximo pedido elegível.",
    },
  },
};

function normalizeOutboxEventTypeToTemplateKey(eventType: string): string {
  const normalized = eventType.trim();
  const lower = normalized.toLowerCase();
  if (VERSIONED_NOTIFICATION_TEMPLATES_V1[lower]) {
    return lower;
  }
  switch (normalized.toUpperCase()) {
    case "ORDER_CREATED":
      return "order.created";
    case "ORDER_ACCEPTED":
    case "ORDER_PREPARING":
    case "ORDER_READY_FOR_PICKUP":
    case "ORDER_DISPATCHED":
    case "ORDER_CANCELLED":
    case "ORDER_STATUS_CHANGED":
      return "order.status_changed";
    case "ORDER_DELIVERED":
    case "DELIVERY_COMPLETED":
      return "delivery.completed";
    case "PAYMENT_CAPTURED":
      return "payment.captured";
    case "PAYMENT_REFUNDED":
    case "REFUND_APPROVED":
      return "payment.refunded";
    case "DELIVERY_OFFER_CREATED":
    case "OFFER_CREATED":
      return "delivery.offer_created";
    case "DELIVERY_ASSIGNED":
    case "OFFER_ACCEPTED":
      return "delivery.assigned";
    case "SUPPORT_CASE_UPDATED":
    case "SUPPORT_MESSAGE_ADDED":
      return "support.case_updated";
    case "PAYOUT_SETTLED":
    case "SETTLEMENT_UPDATED":
      return "payout.settled";
    case "SECURITY_DEVICE_REVOKED":
      return "security.device_revoked";
    case "MARKETING_PROMO":
      return "marketing.promo";
    default:
      return "order.status_changed";
  }
}

function interpolateTemplateTokens(
  templateText: string,
  tokens: Record<string, string | number>
): string {
  return templateText.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const val = tokens[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

/**
 * Renders a versioned (`v1`) notification template in `en` or `pt-BR` based on the event type,
 * recipient's preferred locale, and payload parameters (M20).
 */
export function renderVersionedNotificationTemplate(params: {
  eventType: string;
  locale?: string | null;
  payload?: Record<string, unknown>;
  version?: number;
}): NotificationTemplateVersionContract {
  const locale: SupportedLocale = resolveSupportedLocale(params.locale);
  const templateKey = normalizeOutboxEventTypeToTemplateKey(params.eventType);
  const entry =
    VERSIONED_NOTIFICATION_TEMPLATES_V1[templateKey] ??
    VERSIONED_NOTIFICATION_TEMPLATES_V1["order.status_changed"]!;

  const p = params.payload ?? {};
  const amountCents =
    typeof p.amountCents === "number" && Number.isSafeInteger(p.amountCents) && p.amountCents >= 0
      ? p.amountCents
      : typeof p.totalCents === "number" && Number.isSafeInteger(p.totalCents) && p.totalCents >= 0
        ? p.totalCents
        : null;

  const tokens: Record<string, string | number> = {
    orderNumber:
      p.orderNumber !== undefined
        ? String(p.orderNumber)
        : p.orderId !== undefined
          ? String(p.orderId).slice(-6)
          : "10001",
    storeName:
      p.storeName !== undefined ? String(p.storeName) : "Paulista Artisan Burgers - Jardins",
    status:
      p.orderStatus !== undefined
        ? String(p.orderStatus)
        : p.status !== undefined
          ? String(p.status)
          : params.eventType,
    amount: amountCents !== null ? formatBrlCents(amountCents, locale) : "R$ 0,00",
    distance: p.distanceMeters !== undefined ? Number(p.distanceMeters) : 1420,
    caseNumber: p.caseNumber !== undefined ? String(p.caseNumber) : "5001",
    settlementId: p.settlementId !== undefined ? String(p.settlementId).slice(-6) : "1713",
    deviceIdentifier:
      p.deviceIdentifier !== undefined ? String(p.deviceIdentifier) : "mobile-device",
    promoCode: p.promoCode !== undefined ? String(p.promoCode) : "WELCOME10",
  };

  const localized = entry[locale] ?? entry.en;
  return {
    templateKey: entry.templateKey,
    version: params.version ?? entry.version,
    category: entry.category,
    locale,
    title: interpolateTemplateTokens(localized.title, tokens),
    body: interpolateTemplateTokens(localized.body, tokens),
  };
}

/**
 * Evaluates whether a notification can be delivered on the target channel (M20):
 * - Enforces that `TRANSACTIONAL` and `SECURITY` alerts cannot be opted out, whereas
 *   `MARKETING` notifications respect `user_preferences`.
 * - Immediately blocks `PUSH` / `PUSH_ANDROID` / `PUSH_IOS` when the device is revoked (`isRevoked` or `revokedAtIso`)
 *   or push consent is not granted.
 * - Enforces Option 2 Honest Provider Readiness: records `BLOCKED_MISSING_CREDENTIALS` for external
 *   channels (`PUSH*`, `EMAIL`, `WEBHOOK`) when external credentials are not configured.
 */
export function evaluateNotificationChannelEligibility(params: {
  channel: NotificationChannel;
  category: NotificationCategory;
  preferences?: {
    pushOrderUpdates: boolean;
    pushPromotions: boolean;
    emailTransactional: boolean;
    emailMarketing: boolean;
  } | null;
  device?: {
    isRevoked: boolean;
    revokedAtIso?: string | null;
    pushConsentGranted: boolean;
    pushToken?: string | null;
  } | null;
  providerStatus?: ProviderReadinessStatus | null;
}): {
  eligible: boolean;
  deliveryStatus: NotificationDeliveryStatus;
  reasonCode: string;
} {
  const { channel, category, preferences, device, providerStatus } = params;

  if (channel === "IN_APP") {
    if (
      category === "MARKETING" &&
      preferences &&
      !preferences.pushPromotions &&
      !preferences.emailMarketing
    ) {
      return {
        eligible: false,
        deliveryStatus: "SKIPPED_OPT_OUT",
        reasonCode: "MARKETING_OPT_OUT",
      };
    }
    return {
      eligible: true,
      deliveryStatus: "DELIVERED",
      reasonCode: "IN_APP_PERSISTED",
    };
  }

  if (channel === "PUSH" || channel === "PUSH_ANDROID" || channel === "PUSH_IOS") {
    if (!device || device.isRevoked || Boolean(device.revokedAtIso) || !device.pushToken) {
      return {
        eligible: false,
        deliveryStatus: "BLOCKED_DEVICE_REVOKED",
        reasonCode: "DEVICE_REVOKED_OR_TOKEN_CLEARED",
      };
    }
    if (!device.pushConsentGranted) {
      return {
        eligible: false,
        deliveryStatus: "SKIPPED_OPT_OUT",
        reasonCode: "PUSH_CONSENT_NOT_GRANTED",
      };
    }
    if (category === "MARKETING" && preferences && !preferences.pushPromotions) {
      return {
        eligible: false,
        deliveryStatus: "SKIPPED_OPT_OUT",
        reasonCode: "MARKETING_PUSH_OPT_OUT",
      };
    }
    if (
      providerStatus !== "ACTIVE" &&
      providerStatus !== "ACTIVE_PRODUCTION" &&
      providerStatus !== "SANDBOX_READY"
    ) {
      return {
        eligible: false,
        deliveryStatus: "BLOCKED_MISSING_CREDENTIALS",
        reasonCode: "PROVIDER_MISSING_CREDENTIALS",
      };
    }
    return {
      eligible: true,
      deliveryStatus: "SENT_TO_PROVIDER",
      reasonCode: "PUSH_DISPATCH_READY",
    };
  }

  if (channel === "EMAIL") {
    if (category === "MARKETING" && preferences && !preferences.emailMarketing) {
      return {
        eligible: false,
        deliveryStatus: "SKIPPED_OPT_OUT",
        reasonCode: "MARKETING_EMAIL_OPT_OUT",
      };
    }
    if (
      providerStatus !== "ACTIVE" &&
      providerStatus !== "ACTIVE_PRODUCTION" &&
      providerStatus !== "SANDBOX_READY"
    ) {
      return {
        eligible: false,
        deliveryStatus: "BLOCKED_MISSING_CREDENTIALS",
        reasonCode: "PROVIDER_MISSING_CREDENTIALS",
      };
    }
    return {
      eligible: true,
      deliveryStatus: "SENT_TO_PROVIDER",
      reasonCode: "EMAIL_DISPATCH_READY",
    };
  }

  // WEBHOOK channel
  if (
    providerStatus !== "ACTIVE" &&
    providerStatus !== "ACTIVE_PRODUCTION" &&
    providerStatus !== "SANDBOX_READY"
  ) {
    return {
      eligible: false,
      deliveryStatus: "BLOCKED_MISSING_CREDENTIALS",
      reasonCode: "WEBHOOK_CREDENTIALS_MISSING",
    };
  }
  return {
    eligible: true,
    deliveryStatus: "SENT_TO_PROVIDER",
    reasonCode: "WEBHOOK_DISPATCH_READY",
  };
}

/**
 * Signs an outbound webhook payload using HMAC-SHA256 with a timestamp anti-replay header (M20).
 */
export function signOutboundWebhookPayload(params: {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  secret: string;
  timestampSeconds?: number;
}): OutboundWebhookEnvelopeContract {
  if (!params.secret || params.secret.trim().length < 8) {
    throw new Error("WEBHOOK_SECRET_REQUIRED: Webhook signing secret must be at least 8 characters.");
  }
  const timestampSeconds = params.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const payloadJson = JSON.stringify(params.payload);
  const canonicalMessage = `${timestampSeconds}.${params.eventId}.${payloadJson}`;
  const signatureHex = crypto
    .createHmac("sha256", params.secret)
    .update(canonicalMessage, "utf8")
    .digest("hex");

  return {
    eventId: params.eventId,
    eventType: params.eventType,
    timestampSeconds,
    signatureHex,
    payloadJson,
  };
}

/**
 * Verifies an outbound/partner webhook envelope signature and enforces anti-replay timestamp tolerance (M20).
 */
export function verifyOutboundWebhookSignature(params: {
  envelope: OutboundWebhookEnvelopeContract;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): {
  valid: boolean;
  reasonCode: string;
} {
  const toleranceSeconds = params.toleranceSeconds ?? 300;
  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const driftSeconds = Math.abs(nowSeconds - params.envelope.timestampSeconds);
  if (driftSeconds > toleranceSeconds) {
    return {
      valid: false,
      reasonCode: "WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE",
    };
  }

  const canonicalMessage = `${params.envelope.timestampSeconds}.${params.envelope.eventId}.${params.envelope.payloadJson}`;
  const expectedHex = crypto
    .createHmac("sha256", params.secret)
    .update(canonicalMessage, "utf8")
    .digest("hex");

  const expectedBuf = Buffer.from(expectedHex, "utf8");
  const receivedBuf = Buffer.from(params.envelope.signatureHex, "utf8");
  if (
    expectedBuf.length !== receivedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    return {
      valid: false,
      reasonCode: "WEBHOOK_SIGNATURE_MISMATCH",
    };
  }

  return {
    valid: true,
    reasonCode: "WEBHOOK_VERIFIED",
  };
}

/**
 * Reconciles a user's notification list after a Realtime WebSocket connection drop using
 * monotonic `cursorSeq` without duplicating previously received notifications (M20).
 */
export function reconcileNotificationsSinceCursor(params: {
  existingNotifications: readonly NotificationDeliveryContract[];
  incomingBatch: readonly NotificationDeliveryContract[];
  sinceCursorSeq?: number;
}): {
  merged: NotificationDeliveryContract[];
  latestCursorSeq: number;
  newlyRecoveredCount: number;
} {
  const sinceCursorSeq = params.sinceCursorSeq ?? 0;
  const byId = new Map<string, NotificationDeliveryContract>();
  const byCompositeKey = new Set<string>();

  for (const item of params.existingNotifications) {
    byId.set(item.id, item);
    if (item.outboxEventId) {
      byCompositeKey.add(`${item.outboxEventId}:${item.channel}:${item.recipientUserId}`);
    }
  }

  let newlyRecoveredCount = 0;
  for (const incoming of params.incomingBatch) {
    if (incoming.cursorSeq <= sinceCursorSeq && byId.has(incoming.id)) {
      byId.set(incoming.id, incoming);
      continue;
    }
    const compositeKey = incoming.outboxEventId
      ? `${incoming.outboxEventId}:${incoming.channel}:${incoming.recipientUserId}`
      : null;

    if (!byId.has(incoming.id) && (!compositeKey || !byCompositeKey.has(compositeKey))) {
      if (incoming.cursorSeq > sinceCursorSeq) {
        newlyRecoveredCount += 1;
      }
      if (compositeKey) {
        byCompositeKey.add(compositeKey);
      }
    }
    byId.set(incoming.id, incoming);
  }

  const merged = Array.from(byId.values()).sort((a, b) => a.cursorSeq - b.cursorSeq);
  const latestCursorSeq = merged.reduce(
    (max, item) => (item.cursorSeq > max ? item.cursorSeq : max),
    sinceCursorSeq
  );

  return {
    merged,
    latestCursorSeq,
    newlyRecoveredCount,
  };
}

// ============================================================================
// Fase R (M21): Reproducible Analytical KPIs, Explainable Risk & LGPD Privacy
// ============================================================================

/**
 * Computes reproducible analytical KPIs (GMV, Net Platform Revenue, Operational Margin,
 * Quote-to-Order Conversion, Cancellation Breakdown, Prep/Delivery SLAs, and Regional Breakdown)
 * and reconciles Net Platform Revenue cent-for-cent against the M13 double-entry ledger (M21).
 */
export function computeReproducibleAnalyticalKpis(params: {
  orderRows: readonly AnalyticalOrderKpiRowContract[];
  totalQuotesCount: number;
  consumedQuotesCount: number;
  ledgerRevenueNetCents?: number;
  excludeTestData?: boolean;
}): AnalyticalKpiSummaryContract {
  const excludeTestData = Boolean(params.excludeTestData);
  const filteredRows = excludeTestData
    ? params.orderRows.filter((row) => !row.isTestData)
    : [...params.orderRows];

  let gmvCents = 0;
  let netPlatformRevenueCents = 0;
  let pendingPaymentNetRevenueCents = 0;
  let totalPlatformCommissionCents = 0;
  let totalServiceFeeCents = 0;
  let totalPlatformCouponSubsidyCents = 0;
  let operationalMarginCents = 0;
  let nonCancelledOrdersCount = 0;
  let cancelledOrdersCount = 0;

  let prepSlaSum = 0;
  let prepSlaCount = 0;
  let deliverySlaSum = 0;
  let deliverySlaCount = 0;

  const cancellationMap = new Map<
    string,
    { cancelledByRole: string; cancellationReason: string; count: number }
  >();
  const regionalMap = new Map<
    string,
    {
      city: string;
      stateCode: string;
      ordersCount: number;
      gmvCents: number;
      netPlatformRevenueCents: number;
      operationalMarginCents: number;
    }
  >();

  for (const row of filteredRows) {
    const isCancelledOrExpired =
      row.orderStatus === "CANCELLED" || row.orderStatus === "EXPIRED";

    if (isCancelledOrExpired) {
      cancelledOrdersCount += 1;
      const role = row.cancelledByRole ?? "UNKNOWN";
      const reason = row.cancellationReason ?? "UNSPECIFIED";
      const key = `${role}::${reason}`;
      const existing = cancellationMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        cancellationMap.set(key, {
          cancelledByRole: role,
          cancellationReason: reason,
          count: 1,
        });
      }
      continue;
    }

    nonCancelledOrdersCount += 1;
    const orderGmv =
      row.subtotalCents + row.addonsCents + row.deliveryFeeCents + row.serviceFeeCents;
    const orderNetRevenue =
      row.platformCommissionCents + row.serviceFeeCents - row.platformCouponSubsidyCents;
    const isPaymentCapturedForLedger =
      row.paymentStatus === "CAPTURED" || row.paymentStatus === "PARTIALLY_REFUNDED";
    const recognizedOrderNetRevenue = isPaymentCapturedForLedger ? orderNetRevenue : 0;
    const logisticsSubsidyCents = Math.max(0, row.courierEarningsCents - row.deliveryFeeCents);
    const orderOperationalMargin = recognizedOrderNetRevenue - logisticsSubsidyCents;

    gmvCents += orderGmv;
    if (isPaymentCapturedForLedger) {
      netPlatformRevenueCents += orderNetRevenue;
      totalPlatformCommissionCents += row.platformCommissionCents;
      totalServiceFeeCents += row.serviceFeeCents;
      totalPlatformCouponSubsidyCents += row.platformCouponSubsidyCents;
      operationalMarginCents += orderOperationalMargin;
    } else {
      pendingPaymentNetRevenueCents += orderNetRevenue;
    }

    if (row.prepSlaMinutes !== null && Number.isFinite(row.prepSlaMinutes)) {
      prepSlaSum += row.prepSlaMinutes;
      prepSlaCount += 1;
    }
    if (row.deliverySlaMinutes !== null && Number.isFinite(row.deliverySlaMinutes)) {
      deliverySlaSum += row.deliverySlaMinutes;
      deliverySlaCount += 1;
    }

    const regionKey = `${row.city}::${row.stateCode}`;
    const reg = regionalMap.get(regionKey);
    if (reg) {
      reg.ordersCount += 1;
      reg.gmvCents += orderGmv;
      reg.netPlatformRevenueCents += recognizedOrderNetRevenue;
      reg.operationalMarginCents += orderOperationalMargin;
    } else {
      regionalMap.set(regionKey, {
        city: row.city,
        stateCode: row.stateCode,
        ordersCount: 1,
        gmvCents: orderGmv,
        netPlatformRevenueCents: recognizedOrderNetRevenue,
        operationalMarginCents: orderOperationalMargin,
      });
    }
  }

  const totalOrdersCount = filteredRows.length;
  const quoteConversionRateBps =
    params.totalQuotesCount > 0
      ? Math.round((params.consumedQuotesCount * 10000) / params.totalQuotesCount)
      : 0;
  const cancellationRateBps =
    totalOrdersCount > 0
      ? Math.round((cancelledOrdersCount * 10000) / totalOrdersCount)
      : 0;

  const ledgerReconciledNetRevenueCents =
    params.ledgerRevenueNetCents !== undefined
      ? params.ledgerRevenueNetCents
      : netPlatformRevenueCents;
  const isReconciledWithLedger =
    ledgerReconciledNetRevenueCents === netPlatformRevenueCents;

  const cancellationBreakdown = Array.from(cancellationMap.values()).map((item) => ({
    ...item,
    shareBps:
      cancelledOrdersCount > 0 ? Math.round((item.count * 10000) / cancelledOrdersCount) : 0,
  }));

  return {
    excludeTestData,
    gmvCents,
    netPlatformRevenueCents,
    pendingPaymentNetRevenueCents,
    ledgerReconciledNetRevenueCents,
    isReconciledWithLedger,
    totalPlatformCommissionCents,
    totalServiceFeeCents,
    totalPlatformCouponSubsidyCents,
    operationalMarginCents,
    totalQuotesCount: params.totalQuotesCount,
    consumedQuotesCount: params.consumedQuotesCount,
    quoteConversionRateBps,
    totalOrdersCount,
    nonCancelledOrdersCount,
    cancelledOrdersCount,
    cancellationRateBps,
    averagePrepSlaMinutes:
      prepSlaCount > 0 ? Math.round((prepSlaSum / prepSlaCount) * 100) / 100 : null,
    averageDeliverySlaMinutes:
      deliverySlaCount > 0
        ? Math.round((deliverySlaSum / deliverySlaCount) * 100)
        / 100
        : null,
    cancellationBreakdown,
    regionalBreakdown: Array.from(regionalMap.values()),
    orderRows: filteredRows,
  };
}

/**
 * Formats analytical order KPI rows into a deterministic CSV string for audited export (M21).
 */
export function formatAnalyticalKpisCsv(
  rows: readonly AnalyticalOrderKpiRowContract[]
): string {
  const header = [
    "order_id",
    "order_number",
    "store_id",
    "store_name",
    "city",
    "state_code",
    "order_status",
    "gmv_cents",
    "platform_net_revenue_cents",
    "operational_margin_cents",
    "prep_sla_minutes",
    "delivery_sla_minutes",
    "is_test_data",
    "created_at",
  ].join(",");

  const escapeCsv = (val: string | number | boolean | null): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = rows.map((r) =>
    [
      escapeCsv(r.orderId),
      escapeCsv(r.orderNumber),
      escapeCsv(r.storeId),
      escapeCsv(r.storeName),
      escapeCsv(r.city),
      escapeCsv(r.stateCode),
      escapeCsv(r.orderStatus),
      escapeCsv(r.gmvCents),
      escapeCsv(r.platformNetRevenueCents),
      escapeCsv(r.operationalMarginCents),
      escapeCsv(r.prepSlaMinutes),
      escapeCsv(r.deliverySlaMinutes),
      escapeCsv(r.isTestData),
      escapeCsv(r.createdAt),
    ].join(",")
  );

  return [header, ...lines].join("\n");
}

/**
 * Evaluates a deterministic, explainable risk rule (M21).
 * NEVER applies an opaque automated permanent ban; any triggered alert requires mandatory human review.
 */
export function evaluateExplainableRiskRule(params: {
  ruleCode: ExplainableRiskRuleCode;
  subjectType: RiskAlertContract["subjectType"];
  subjectId: string;
  observedValue: number;
  thresholdValue?: number;
  evidenceRefs?: readonly string[];
}): {
  triggered: boolean;
  severity: RiskAlertSeverity;
  status: RiskAlertStatus;
  recommendedAction: "HUMAN_REVIEW_REQUIRED" | "ALLOW";
  ruleExplanation: RiskRuleExplanationContract;
} {
  const evidenceRefs = params.evidenceRefs ? [...params.evidenceRefs] : [];
  let defaultThreshold = 0;
  let severity: RiskAlertSeverity = "MEDIUM";
  let windowDescription = "";
  let explanationEn = "";
  let explanationPtBr = "";

  switch (params.ruleCode) {
    case "VELOCITY_HIGH_REFUND_RATE": {
      defaultThreshold = params.thresholdValue ?? 3000; // 30.00% refund rate in bps over 30d
      severity = "HIGH";
      windowDescription = "Last 30 days refund ratio in bps";
      const obsPct = (params.observedValue / 100).toFixed(2);
      const thrPct = (defaultThreshold / 100).toFixed(2);
      explanationEn = `Refund ratio (${obsPct}%) exceeded deterministic threshold (${thrPct}%) over the last 30 days. Mandatory human review required.`;
      explanationPtBr = `Taxa de reembolso (${obsPct}%) excedeu o limiar determinístico (${thrPct}%) nos últimos 30 dias. Revisão humana obrigatória.`;
      break;
    }
    case "COURIER_REPEATED_OTP_FAILURES": {
      defaultThreshold = params.thresholdValue ?? 3; // 3 failed OTP handoffs in 24h
      severity = "HIGH";
      windowDescription = "Last 24 hours failed OTP handoff attempts";
      explanationEn = `Courier recorded ${params.observedValue} failed OTP handoff attempts in 24h (threshold: ${defaultThreshold}). Mandatory human review required.`;
      explanationPtBr = `Entregador registrou ${params.observedValue} falhas de código OTP em 24h (limiar: ${defaultThreshold}). Revisão humana obrigatória.`;
      break;
    }
    case "COUPON_ABUSE_MULTI_ACCOUNT": {
      defaultThreshold = params.thresholdValue ?? 2; // >2 accounts redeeming same device/fingerprint
      severity = "CRITICAL";
      windowDescription = "Distinct accounts redeeming first-order coupon on same device";
      explanationEn = `Detected ${params.observedValue} accounts redeeming promotional coupons on the same device identifier (threshold: ${defaultThreshold}). Mandatory human review required.`;
      explanationPtBr = `Detectadas ${params.observedValue} contas resgatando cupons promocionais no mesmo identificador de dispositivo (limiar: ${defaultThreshold}). Revisão humana obrigatória.`;
      break;
    }
    case "HIGH_VALUE_ORDER_NEW_ACCOUNT": {
      defaultThreshold = params.thresholdValue ?? 15000; // R$ 150.00 on account < 7 days old
      severity = "MEDIUM";
      windowDescription = "First 7 days order total in cents";
      explanationEn = `Order total (${formatBrlCents(Math.max(0, Math.round(params.observedValue)), "en")}) on newly registered account exceeded threshold (${formatBrlCents(defaultThreshold, "en")}). Mandatory human review required.`;
      explanationPtBr = `Valor do pedido (${formatBrlCents(Math.max(0, Math.round(params.observedValue)), "pt-BR")}) em conta recém-cadastrada excedeu o limiar (${formatBrlCents(defaultThreshold, "pt-BR")}). Revisão humana obrigatória.`;
      break;
    }
    case "BANK_ACCOUNT_FREQUENT_CHANGES": {
      defaultThreshold = params.thresholdValue ?? 2; // >2 bank account changes in 30 days
      severity = "HIGH";
      windowDescription = "Last 30 days bank account change requests";
      explanationEn = `Organization submitted ${params.observedValue} bank account change requests in 30 days (threshold: ${defaultThreshold}). Mandatory human review required.`;
      explanationPtBr = `Organização enviou ${params.observedValue} solicitações de troca de conta bancária em 30 dias (limiar: ${defaultThreshold}). Revisão humana obrigatória.`;
      break;
    }
  }

  const triggered = params.observedValue > defaultThreshold;
  return {
    triggered,
    severity,
    status: "OPEN_AWAITING_HUMAN_REVIEW",
    recommendedAction: triggered ? "HUMAN_REVIEW_REQUIRED" : "ALLOW",
    ruleExplanation: {
      ruleCode: params.ruleCode,
      observedValue: params.observedValue,
      thresholdValue: defaultThreshold,
      windowDescription,
      explanationEn,
      explanationPtBr,
      evidenceRefs,
    },
  };
}

/**
 * Validates a human review decision on an explainable risk alert (M21).
 * Requires `risk_compliance` or `tech_admin` role, MFA `aal2`, and a non-empty justification.
 */
export function validateHumanRiskReview(params: {
  actorId: string;
  actorRoles: readonly StaffRole[];
  actorAal: "aal1" | "aal2";
  alert: RiskAlertContract;
  decision: RiskHumanReviewDecision;
  reason: string;
  now?: Date;
}): {
  updatedStatus: RiskAlertStatus;
  decision: RiskHumanReviewDecision;
  reason: string;
  reviewedAtIso: string;
} {
  const canReview =
    params.actorRoles.includes("risk_compliance") ||
    params.actorRoles.includes("tech_admin");
  if (!canReview) {
    throw new Error(
      "RISK_REVIEW_FORBIDDEN: Only risk_compliance or tech_admin staff can review risk alerts."
    );
  }
  if (params.actorAal !== "aal2") {
    throw new Error(
      "RISK_REVIEW_MFA_AAL2_REQUIRED: Multi-factor authentication (aal2) is required to review risk alerts."
    );
  }
  if (params.actorId === params.alert.subjectId) {
    throw new Error(
      "RISK_REVIEW_SELF_FORBIDDEN: Reviewer cannot adjudicate a risk alert targeting their own account."
    );
  }
  const trimmedReason = (params.reason ?? "").trim();
  if (trimmedReason.length < 5) {
    throw new Error(
      "RISK_REVIEW_REASON_REQUIRED: Human review requires a justification of at least 5 characters."
    );
  }

  const statusMap: Record<RiskHumanReviewDecision, RiskAlertStatus> = {
    APPROVE_OVERRIDE: "APPROVED_OVERRIDE",
    CONFIRM_BLOCK: "CONFIRMED_BLOCK",
    DISMISS_FALSE_POSITIVE: "DISMISSED_FALSE_POSITIVE",
  };

  return {
    updatedStatus: statusMap[params.decision],
    decision: params.decision,
    reason: trimmedReason,
    reviewedAtIso: (params.now ?? new Date()).toISOString(),
  };
}

/**
 * Builds a structured LGPD Art. 18, V data portability JSON package for a data subject (M21).
 */
export function buildLgpdDataPortabilityPackage(params: {
  profile: {
    id: string;
    email: string;
    fullName: string;
    phone: string | null;
    preferredLocale: SupportedLocale;
    status: string;
  };
  addresses: ReadonlyArray<Record<string, unknown>>;
  orders: ReadonlyArray<{
    id: string;
    orderNumber: number;
    storeId: string;
    totalCents: number;
    orderStatus: string;
    createdAt: string;
  }>;
  supportCases: ReadonlyArray<{
    id: string;
    caseNumber: number;
    category: string;
    status: string;
    createdAt: string;
  }>;
  generatedAt?: Date;
}): Record<string, unknown> {
  return {
    schemaVersion: "lgpd-portability-v1",
    legalBasis: "LGPD_ART_18_V_PORTABILITY",
    generatedAt: (params.generatedAt ?? new Date()).toISOString(),
    subjectProfile: {
      id: params.profile.id,
      email: params.profile.email,
      fullName: params.profile.fullName,
      phone: params.profile.phone,
      preferredLocale: params.profile.preferredLocale,
      status: params.profile.status,
    },
    savedAddressesCount: params.addresses.length,
    savedAddresses: params.addresses,
    ordersHistoryCount: params.orders.length,
    ordersHistory: params.orders,
    supportCasesCount: params.supportCases.length,
    supportCases: params.supportCases,
  };
}

/**
 * Deterministically anonymizes a user profile's PII for LGPD erasure/anonymization requests
 * while preserving the primary key UUID for immutable financial/audit referential integrity (M21).
 */
export function anonymizeProfilePii(params: {
  userId: string;
  hasActiveOrders: boolean;
  hasOpenFinancialDisputes: boolean;
  hasCompletedFiscalTransactions: boolean;
  now?: Date;
}): {
  allowed: boolean;
  reasonCode: string;
  holdUntilIso: string | null;
  anonymizedEmail: string | null;
  anonymizedFullName: string | null;
  anonymizedPhone: null;
  anonymizedAtIso: string | null;
} {
  const evaluation = evaluateAccountDeletionRequest({
    userId: params.userId,
    hasActiveOrders: params.hasActiveOrders,
    hasOpenFinancialDisputes: params.hasOpenFinancialDisputes,
    hasCompletedFiscalTransactions: params.hasCompletedFiscalTransactions,
    requestedAt: params.now ?? new Date(),
  });

  if (evaluation.outcome !== "IMMEDIATE_ANONYMIZATION") {
    return {
      allowed: false,
      reasonCode: evaluation.reasonCode,
      holdUntilIso: evaluation.holdUntilIso,
      anonymizedEmail: null,
      anonymizedFullName: null,
      anonymizedPhone: null,
      anonymizedAtIso: null,
    };
  }

  const hashPrefix = crypto
    .createHash("sha256")
    .update(params.userId, "utf8")
    .digest("hex")
    .slice(0, 12);

  return {
    allowed: true,
    reasonCode: "PII_ANONYMIZED_LGPD_COMPLIANT",
    holdUntilIso: null,
    anonymizedEmail: `anon+${hashPrefix}@anonymized.ideliveryfood.invalid`,
    anonymizedFullName: `Anonymized User #${hashPrefix.slice(0, 6)}`,
    anonymizedPhone: null,
    anonymizedAtIso: (params.now ?? new Date()).toISOString(),
  };
}





