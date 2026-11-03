import crypto from "node:crypto";
import {
  CURRENCY_CODE,
  OPERATIONAL_TIMEZONE,
  assertIntegerCents,
  type CartItemSelectionContract,
  type CatalogProductContract,
  type FulfillmentModality,
  type OrderEventRecordContract,
  type OrderRecordContract,
  type ProviderReadinessStatus,
  type QuoteItemSnapshotContract,
  type ServerQuoteRecordContract,
  type ServiceAreaEligibilityContract,
  type StoreAvailabilityEvaluationContract,
  type StoreHourExceptionContract,
  type StoreOperatingHourContract,
  type StoreServiceAreaContract,
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
  discountFundedBy: "PLATFORM" | "MERCHANT" | "NONE";
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
  const merchantDiscountDeduction =
    params.discountFundedBy === "MERCHANT" ? discountCents : 0;
  const platformPromoSubsidyCents =
    params.discountFundedBy === "PLATFORM" ? discountCents : 0;

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
  discountFundedBy: "PLATFORM" | "MERCHANT" | "NONE";
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
