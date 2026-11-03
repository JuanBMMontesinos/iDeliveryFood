import { authorizePartnerScope } from "@ideliveryfood/authz";
import {
  DEFAULT_LOCALE,
  translateMessage,
  type AuthenticatedActorProfileContract,
  type BankAccountChangeRequestContract,
  type BatchCatalogUpdateItemResultContract,
  type OrderEventRecordContract,
  type OrderRecordContract,
  type StoreOrdersQueueResponseContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  buildKitchenOrderQueue,
  createBankAccountChangeRequest,
  executeOrderCommand,
  reconcileKitchenOrderEventsOnReconnect,
  type OrderCommandType,
} from "@ideliveryfood/domain";
import {
  buildLanguageSelectorViewModel,
  buildUiScreenStateBanner,
  type LanguageSelectorViewModel,
  type UiScreenStateBanner,
} from "@ideliveryfood/ui-web";

export interface PartnerPortalScreenModel {
  portalTitle: string;
  localeSelector: LanguageSelectorViewModel;
  canAccessStoreOperations: boolean;
  canAccessFinancialLedger: boolean;
  financeSegregationNotice: string | null;
  banner: UiScreenStateBanner | null;
}

/**
 * Evaluates Partner Portal access for a given organization/store scope and enforces
 * segregation between operational roles (partner_operator/catalog) and financial roles (partner_finance/owner).
 */
export function buildPartnerPortalScreenModel(params: {
  actor: AuthenticatedActorProfileContract;
  organizationId: string;
  storeId?: string | null;
  locale?: SupportedLocale;
}): PartnerPortalScreenModel {
  const locale = params.locale ?? params.actor.preferredLocale ?? DEFAULT_LOCALE;
  const localeSelector = buildLanguageSelectorViewModel(locale);
  const portalTitle = translateMessage("partner.portal.title", locale);

  const opsDecision = authorizePartnerScope({
    actor: params.actor,
    organizationId: params.organizationId,
    storeId: params.storeId ?? null,
    allowedRoles: [
      "partner_owner",
      "partner_manager",
      "partner_operator",
      "partner_catalog",
      "partner_finance",
      "partner_marketing",
      "partner_support",
    ],
  });

  if (!opsDecision.allowed) {
    const bannerKind =
      opsDecision.reasonCode === "DENIED_MFA_STEP_UP_REQUIRED" ? "mfa_required" : "forbidden";
    return {
      portalTitle,
      localeSelector,
      canAccessStoreOperations: false,
      canAccessFinancialLedger: false,
      financeSegregationNotice: null,
      banner: buildUiScreenStateBanner({ kind: bannerKind, locale }),
    };
  }

  const financeDecision = authorizePartnerScope({
    actor: params.actor,
    organizationId: params.organizationId,
    storeId: null,
    allowedRoles: ["partner_owner", "partner_finance"],
  });

  return {
    portalTitle,
    localeSelector,
    canAccessStoreOperations: true,
    canAccessFinancialLedger: financeDecision.allowed,
    financeSegregationNotice: financeDecision.allowed
      ? null
      : translateMessage("partner.finance.segregated_notice", locale),
    banner: null,
  };
}

/**
 * Evaluates a multi-unit batch catalog update across target store units and builds a partial status summary (M09).
 */
export function evaluateMultiUnitCatalogBatch(params: {
  actor: AuthenticatedActorProfileContract;
  organizationId: string;
  productId: string;
  targetStoreIds: readonly string[];
  locale?: SupportedLocale;
}): {
  results: BatchCatalogUpdateItemResultContract[];
  summaryText: string;
} {
  const locale = params.locale ?? params.actor.preferredLocale ?? DEFAULT_LOCALE;
  const results: BatchCatalogUpdateItemResultContract[] = [];

  for (const storeId of params.targetStoreIds) {
    const decision = authorizePartnerScope({
      actor: params.actor,
      organizationId: params.organizationId,
      storeId,
      allowedRoles: ["partner_owner", "partner_manager", "partner_catalog", "partner_operator"],
    });
    results.push({
      storeId,
      productId: params.productId,
      status: decision.allowed ? "APPLIED" : "DENIED_SCOPE",
      reasonCode: decision.reasonCode,
    });
  }

  const applied = results.filter((r) => r.status === "APPLIED").length;
  const denied = results.filter((r) => r.status === "DENIED_SCOPE").length;

  return {
    results,
    summaryText: translateMessage("partner.multi_unit.batch_summary", locale, {
      applied,
      denied,
      total: results.length,
    }),
  };
}

/**
 * Submits a partner bank account change request (M07).
 * Enforces partner_owner role + MFA aal2, creates a PENDING approval request,
 * and never triggers immediate payout liquidation.
 */
export function submitPartnerBankAccountChangeRequest(params: {
  actor: AuthenticatedActorProfileContract;
  organizationId: string;
  storeId: string;
  bankCode: string;
  branchNumber: string;
  accountLast4: string;
  reason: string;
  locale?: SupportedLocale;
}): {
  request: BankAccountChangeRequestContract;
  pendingApprovalNotice: string;
  immediatePayoutTriggered: false;
} {
  const locale = params.locale ?? params.actor.preferredLocale ?? DEFAULT_LOCALE;
  const authz = authorizePartnerScope({
    actor: params.actor,
    organizationId: params.organizationId,
    storeId: params.storeId,
    allowedRoles: ["partner_owner"],
    requireMfaAal2: true,
  });

  if (!authz.allowed) {
    throw new Error(
      `BANK_CHANGE_FORBIDDEN (${authz.reasonCode}): Only Partner Owner with MFA aal2 can request bank account changes.`
    );
  }

  const request = createBankAccountChangeRequest({
    id: `bank_req_${Date.now()}`,
    organizationId: params.organizationId,
    storeId: params.storeId,
    requestedBy: params.actor.id,
    actorAal: params.actor.aal,
    bankCode: params.bankCode,
    branchNumber: params.branchNumber,
    accountLast4: params.accountLast4,
    reason: params.reason,
  });

  return {
    request,
    pendingApprovalNotice: translateMessage("partner.bank_change.pending_approval", locale, {
      accountLast4: request.accountLast4,
    }),
    immediatePayoutTriggered: false,
  };
}

/**
 * Dedicated Restaurant Kitchen Order Console Controller (M08).
 * Separated from store configuration: manages live order columns, real-time SLA countdowns,
 * optimistic locking conflict recovery (409 ORDER_VERSION_CONFLICT), mandatory rejection reasons,
 * reconnect event deduplication, and active order visibility while the store is paused.
 */
export class KitchenOrderConsoleController {
  private readonly storeId: string;
  private isStorePaused: boolean;
  private pauseReason: string | null = null;
  private locale: SupportedLocale;
  private audibleAlertsConsented = false;
  private readonly ordersById = new Map<string, OrderRecordContract>();
  private seenEventIds = new Set<string>();
  private latestEventCursor: string | null = null;

  constructor(params: {
    storeId: string;
    initialOrders?: readonly OrderRecordContract[];
    isStorePaused?: boolean;
    locale?: SupportedLocale;
  }) {
    this.storeId = params.storeId;
    this.isStorePaused = params.isStorePaused ?? false;
    this.locale = params.locale ?? DEFAULT_LOCALE;
    for (const order of params.initialOrders ?? []) {
      if (order.storeId === this.storeId) {
        this.ordersById.set(order.id, order);
      }
    }
  }

  public setLocale(locale: SupportedLocale): void {
    this.locale = locale;
  }

  public setAudibleAlertsConsent(consented: boolean): void {
    this.audibleAlertsConsented = consented;
  }

  public isAudibleAlertEnabled(): boolean {
    return this.audibleAlertsConsented;
  }

  public setStorePaused(isPaused: boolean, reason?: string): void {
    if (isPaused && (!reason || reason.trim().length < 3)) {
      throw new Error("STORE_PAUSE_REASON_REQUIRED: Pause reason is required.");
    }
    this.isStorePaused = isPaused;
    this.pauseReason = isPaused ? (reason?.trim() ?? null) : null;
  }

  public getConsoleViewModel(now?: Date): {
    consoleTitle: string;
    soundConsentLabel: string;
    audibleAlertsEnabled: boolean;
    pausedBanner: string | null;
    queue: StoreOrdersQueueResponseContract;
  } {
    const queue = buildKitchenOrderQueue({
      storeId: this.storeId,
      isStorePaused: this.isStorePaused,
      orders: Array.from(this.ordersById.values()),
      now: now ?? new Date(),
      latestEventCursor: this.latestEventCursor,
    });

    return {
      consoleTitle: translateMessage("kitchen.queue.title", this.locale),
      soundConsentLabel: translateMessage("kitchen.sound.consent_label", this.locale),
      audibleAlertsEnabled: this.audibleAlertsConsented,
      pausedBanner: this.isStorePaused
        ? translateMessage("partner.store.paused_banner", this.locale, {
            reason: this.pauseReason ?? "Manual pause",
          })
        : null,
      queue,
    };
  }

  public executeKitchenCommand(params: {
    actor: AuthenticatedActorProfileContract;
    organizationId: string;
    orderId: string;
    command: Extract<
      OrderCommandType,
      "ACCEPT" | "REJECT" | "START_PREPARING" | "MARK_READY" | "CANCEL"
    >;
    expectedVersion: number;
    reason?: string;
    idempotencyKey: string;
    now?: Date;
  }): {
    outcome: "APPLIED" | "VERSION_CONFLICT";
    order: OrderRecordContract;
    conflictNotice: string | null;
  } {
    const authz = authorizePartnerScope({
      actor: params.actor,
      organizationId: params.organizationId,
      storeId: this.storeId,
      allowedRoles: ["partner_owner", "partner_manager", "partner_operator"],
    });
    if (!authz.allowed) {
      throw new Error(`KITCHEN_COMMAND_FORBIDDEN: ${authz.reasonCode}`);
    }

    if (
      (params.command === "REJECT" || params.command === "CANCEL") &&
      (!params.reason || params.reason.trim().length < 3)
    ) {
      throw new Error(
        "KITCHEN_REJECT_REASON_REQUIRED: A structured reason is mandatory when rejecting or cancelling an order."
      );
    }

    const currentOrder = this.ordersById.get(params.orderId);
    if (!currentOrder) {
      throw new Error(`ORDER_NOT_FOUND: Order ${params.orderId} is not in store ${this.storeId}.`);
    }

    try {
      const result = executeOrderCommand({
        order: currentOrder,
        command: params.command,
        expectedVersion: params.expectedVersion,
        actorId: params.actor.id,
        actorRole: "PARTNER",
        idempotencyKey: params.idempotencyKey,
        ...(params.reason !== undefined ? { reason: params.reason } : {}),
        ...(params.now !== undefined ? { now: params.now } : {}),
      });

      this.ordersById.set(currentOrder.id, result.updatedOrder);
      this.seenEventIds.add(result.event.id);
      this.latestEventCursor = result.event.id;

      return {
        outcome: "APPLIED",
        order: result.updatedOrder,
        conflictNotice: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.startsWith("ORDER_VERSION_CONFLICT")) {
        return {
          outcome: "VERSION_CONFLICT",
          order: currentOrder,
          conflictNotice: translateMessage("kitchen.order.conflict_notice", this.locale, {
            orderNumber: currentOrder.orderNumber,
            version: currentOrder.version,
          }),
        };
      }
      throw err;
    }
  }

  public reconcileEventsOnReconnect(
    incomingEvents: readonly OrderEventRecordContract[]
  ): {
    appliedEventsCount: number;
    latestCursor: string | null;
  } {
    const rec = reconcileKitchenOrderEventsOnReconnect({
      seenEventIds: this.seenEventIds,
      incomingEvents,
    });
    this.seenEventIds = rec.nextSeenEventIds;
    if (rec.latestCursor) {
      this.latestEventCursor = rec.latestCursor;
    }

    for (const evt of rec.newEvents) {
      const existing = this.ordersById.get(evt.orderId);
      if (existing) {
        const eventVersion =
          typeof evt.payload.version === "number" ? evt.payload.version : existing.version + 1;
        this.ordersById.set(existing.id, {
          ...existing,
          orderStatus: evt.newOrderStatus,
          paymentStatus: evt.newPaymentStatus ?? existing.paymentStatus,
          deliveryStatus: evt.newDeliveryStatus ?? existing.deliveryStatus,
          version: Math.max(existing.version, eventVersion),
          updatedAtIso: evt.createdAtIso,
        });
      }
    }

    return {
      appliedEventsCount: rec.newEvents.length,
      latestCursor: this.latestEventCursor,
    };
  }
}
