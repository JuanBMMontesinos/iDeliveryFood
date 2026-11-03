import {
  assertIntegerCents,
  type FulfillmentModality,
  type ProviderReadinessStatus,
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
  CANCELLED: ["REFUNDED"],
  REJECTED: ["REFUNDED"],
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
