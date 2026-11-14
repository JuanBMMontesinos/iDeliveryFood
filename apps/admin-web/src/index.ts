import { authorizeStaffAction } from "@ideliveryfood/authz";
import { inspectProviderReadiness, type ExternalProviderDescriptor } from "@ideliveryfood/config";
import {
  DEFAULT_LOCALE,
  formatBrlCents,
  translateMessage,
  type AdminGovernanceActionContract,
  type AdminStaffScopeGrantRequestContract,
  type AuthenticatedActorProfileContract,
  type DeliveryTaskContract,
  type OrderRecordContract,
  type PspReconciliationRunContract,
  type SettlementRecordContract,
  type StaffRole,
  type SupportActionRequestContract,
  type SupportAttachmentContract,
  type SupportBackofficeOverviewContract,
  type SupportCaseContract,
  type SupportMessageContract,
  type SupportedLocale,
  type CommercialBackofficeOverviewContract,
  type CommercialLeadContract,
  type CommercialProposalContract,
  type CommissionRuleVersionContract,
  type MerchantContractRecordContract,
} from "@ideliveryfood/contracts";
import {
  buildBalancedOrderCaptureJournal,
  evaluateAdminGovernanceDecision,
  evaluateFleetOperatorAccess,
  evaluatePspReconciliationRun,
  evaluateSettlementPayoutExecution,
  evaluateStaffScopeGrant,
} from "@ideliveryfood/domain";
import {
  buildLanguageSelectorViewModel,
  buildUiScreenStateBanner,
  type LanguageSelectorViewModel,
  type UiScreenStateBanner,
} from "@ideliveryfood/ui-web";

export interface AdminGovernanceScreenModel {
  portalTitle: string;
  localeSelector: LanguageSelectorViewModel;
  authorized: boolean;
  banner: UiScreenStateBanner | null;
  providerCards: Array<{
    providerCode: string;
    displayName: string;
    status: ExternalProviderDescriptor["status"];
    blockedBadgeText: string | null;
  }>;
}

/**
 * Builds the Admin Backoffice Governance screen model, enforcing internal staff RBAC + MFA aal2
 * and rendering honest BLOCKED_MISSING_CREDENTIALS badges for unconfigured external providers.
 */
export function buildAdminGovernanceScreenModel(params: {
  actor: AuthenticatedActorProfileContract;
  requiredRoles?: readonly StaffRole[];
  locale?: SupportedLocale;
  env?: Record<string, string | undefined>;
}): AdminGovernanceScreenModel {
  const locale = params.locale ?? params.actor.preferredLocale ?? DEFAULT_LOCALE;
  const localeSelector = buildLanguageSelectorViewModel(locale);
  const portalTitle = translateMessage("admin.portal.title", locale);

  const decision = authorizeStaffAction({
    actor: params.actor,
    allowedRoles: params.requiredRoles ?? [
      "operations",
      "finance",
      "risk_compliance",
      "tech_admin",
    ],
    requireMfaAal2: true,
  });

  if (!decision.allowed) {
    const bannerKind =
      decision.reasonCode === "DENIED_MFA_STEP_UP_REQUIRED" ? "mfa_required" : "forbidden";
    return {
      portalTitle,
      localeSelector,
      authorized: false,
      banner: buildUiScreenStateBanner({ kind: bannerKind, locale }),
      providerCards: [],
    };
  }

  const providers = inspectProviderReadiness(params.env ?? {});
  return {
    portalTitle,
    localeSelector,
    authorized: true,
    banner: null,
    providerCards: providers.map((p) => ({
      providerCode: p.providerCode,
      displayName: p.displayName,
      status: p.status,
      blockedBadgeText:
        p.status === "BLOCKED_MISSING_CREDENTIALS"
          ? translateMessage("admin.providers.blocked_badge", locale, {
              vars: p.missingEnvVars.join(", "),
            })
          : null,
    })),
  };
}

export type AdminModuleKey =
  | "CADASTRE_AND_APPROVALS"
  | "LOGISTICS_DISPATCH_CONSOLE"
  | "SUPPORT_AND_DISPUTES"
  | "FINANCE_LEDGER_AND_SETTLEMENTS"
  | "COMMERCIAL_CONTRACTS"
  | "GROWTH_PROMOTIONS"
  | "RISK_COMPLIANCE_AND_LGPD"
  | "IAM_AND_PROVIDER_GOVERNANCE";

/**
 * Computes which central backoffice modules are accessible for a staff actor's active scopes (M16).
 */
export function buildAdminRoleNavigationModules(
  actor: AuthenticatedActorProfileContract
): AdminModuleKey[] {
  if (actor.status !== "ACTIVE") return [];
  const roles = new Set(actor.staffScopes.map((s) => s.role));
  const modules: AdminModuleKey[] = [];

  if (
    roles.has("operations") ||
    roles.has("commercial") ||
    roles.has("risk_compliance") ||
    roles.has("tech_admin")
  ) {
    modules.push("CADASTRE_AND_APPROVALS");
  }
  if (roles.has("operations") || roles.has("tech_admin")) {
    modules.push("LOGISTICS_DISPATCH_CONSOLE");
  }
  if (
    roles.has("support") ||
    roles.has("support_l1") ||
    roles.has("support_l2") ||
    roles.has("operations") ||
    roles.has("risk_compliance") ||
    roles.has("tech_admin")
  ) {
    modules.push("SUPPORT_AND_DISPUTES");
  }
  if (roles.has("finance") || roles.has("risk_compliance") || roles.has("tech_admin")) {
    modules.push("FINANCE_LEDGER_AND_SETTLEMENTS");
  }
  if (roles.has("commercial") || roles.has("operations") || roles.has("tech_admin")) {
    modules.push("COMMERCIAL_CONTRACTS");
  }
  if (roles.has("growth_marketing") || roles.has("commercial") || roles.has("tech_admin")) {
    modules.push("GROWTH_PROMOTIONS");
  }
  if (roles.has("risk_compliance") || roles.has("tech_admin")) {
    modules.push("RISK_COMPLIANCE_AND_LGPD");
  }
  if (roles.has("tech_admin")) {
    modules.push("IAM_AND_PROVIDER_GOVERNANCE");
  }

  return modules;
}

/**
 * Evaluates a staff role grant in the Central Admin Backoffice (M16), enforcing tech_admin + MFA aal2,
 * mandatory justification, and blocking self-grant with a localized security notice.
 */
export function executeAdminStaffScopeGrant(params: {
  actor: AuthenticatedActorProfileContract;
  request: AdminStaffScopeGrantRequestContract;
  locale?: SupportedLocale;
}): {
  allowed: boolean;
  reasonCode: string;
  errorMessage: string | null;
} {
  const locale = params.locale ?? params.actor.preferredLocale ?? DEFAULT_LOCALE;
  const evalResult = evaluateStaffScopeGrant({
    actorId: params.actor.id,
    actorAal: params.actor.aal,
    actorRoles: params.actor.staffScopes.map((s) => s.role),
    request: params.request,
  });

  if (!evalResult.allowed) {
    const errorMessage =
      evalResult.reasonCode === "DENIED_SELF_GRANT_FORBIDDEN"
        ? translateMessage("admin.self_grant.blocked", locale)
        : evalResult.reasonCode === "DENIED_MFA_AAL2_REQUIRED"
          ? translateMessage("app.state.mfa_required", locale)
          : translateMessage("app.state.forbidden", locale);
    return {
      allowed: false,
      reasonCode: evalResult.reasonCode,
      errorMessage,
    };
  }

  return {
    allowed: true,
    reasonCode: "ALLOWED",
    errorMessage: null,
  };
}

/**
 * Executes an audited onboarding approval, suspension, or reactivation decision (M16).
 */
export function executeAdminCadastreGovernanceAction(params: {
  actor: AuthenticatedActorProfileContract;
  targetType: AdminGovernanceActionContract["targetType"];
  targetId: string;
  decision: AdminGovernanceActionContract["decision"];
  reason: string;
}): AdminGovernanceActionContract {
  return evaluateAdminGovernanceDecision({
    id: `gov_${Date.now()}`,
    actorId: params.actor.id,
    actorAal: params.actor.aal,
    actorRoles: params.actor.staffScopes.map((s) => s.role),
    targetType: params.targetType,
    targetId: params.targetId,
    decision: params.decision,
    reason: params.reason,
  });
}

/**
 * Builds the read-only Audit Log Explorer view model for M16, enforcing immutability
 * (no edit/delete actions exposed) and MFA aal2 for compliance/admin roles.
 */
export function buildAdminAuditTrailExplorerModel<TLog>(params: {
  actor: AuthenticatedActorProfileContract;
  logs: readonly TLog[];
  locale?: SupportedLocale;
}): {
  authorized: boolean;
  isReadOnly: true;
  allowMutationOrDelete: false;
  readOnlyBadgeText: string;
  visibleLogs: readonly TLog[];
} {
  const locale = params.locale ?? params.actor.preferredLocale ?? DEFAULT_LOCALE;
  const decision = authorizeStaffAction({
    actor: params.actor,
    allowedRoles: ["operations", "finance", "risk_compliance", "tech_admin"],
    requireMfaAal2: true,
  });

  return {
    authorized: decision.allowed,
    isReadOnly: true,
    allowMutationOrDelete: false,
    readOnlyBadgeText: translateMessage("admin.audit.read_only_badge", locale),
    visibleLogs: decision.allowed ? params.logs : [],
  };
}

// ============================================================================
// M13: Financial Backoffice, Ledger Balance, Reconciliation & Payouts
// ============================================================================

export interface FinancialBackofficeScreenModel {
  authorized: boolean;
  banner: UiScreenStateBanner | null;
  gmvCents: number;
  netPlatformRevenueCents: number;
  merchantPayablesCents: number;
  courierPayablesCents: number;
  gmvVsRevenueNoticeText: string;
  reconciliationRun: PspReconciliationRunContract | null;
  settlementResult: SettlementRecordContract | null;
  settlementNoticeText: string | null;
}

/**
 * Builds the M13 Financial Backoffice screen model, strictly separating GMV from Net Platform Revenue,
 * generating balanced double-entry journals, running PSP reconciliation, and enforcing payout
 * Segregation of Duties + honest BLOCKED_NO_PSP status.
 */
export function buildFinancialBackofficeModel(params: {
  actor: AuthenticatedActorProfileContract;
  orders: readonly OrderRecordContract[];
  pspReportedCaptures?: ReadonlyArray<{ orderId: string; capturedCents: number }>;
  settlementToExecute?: {
    settlement: SettlementRecordContract;
    providerCode: string;
    bankAccountApprovedByActorId?: string | null;
    externalPayoutReference?: string | null;
  };
  env?: Record<string, string | undefined>;
  locale?: SupportedLocale;
}): FinancialBackofficeScreenModel {
  const locale = params.locale ?? params.actor.preferredLocale ?? DEFAULT_LOCALE;
  const decision = authorizeStaffAction({
    actor: params.actor,
    allowedRoles: ["finance", "tech_admin"],
    requireMfaAal2: true,
  });

  if (!decision.allowed) {
    const bannerKind =
      decision.reasonCode === "DENIED_MFA_STEP_UP_REQUIRED" ? "mfa_required" : "forbidden";
    return {
      authorized: false,
      banner: buildUiScreenStateBanner({ kind: bannerKind, locale }),
      gmvCents: 0,
      netPlatformRevenueCents: 0,
      merchantPayablesCents: 0,
      courierPayablesCents: 0,
      gmvVsRevenueNoticeText: "",
      reconciliationRun: null,
      settlementResult: null,
      settlementNoticeText: null,
    };
  }

  let gmvCents = 0;
  let netPlatformRevenueCents = 0;
  let merchantPayablesCents = 0;
  let courierPayablesCents = 0;

  for (const ord of params.orders) {
    // Verify every captured order produces a balanced double-entry journal
    buildBalancedOrderCaptureJournal({
      journalId: `jnl_${ord.id}`,
      order: ord,
      discountFundedBy: ord.discountCents > 0 ? "PLATFORM" : "NONE",
      postedBy: params.actor.id,
    });

    gmvCents += ord.subtotalCents + ord.addonsCents;
    netPlatformRevenueCents += ord.platformCommissionCents + ord.serviceFeeCents;
    merchantPayablesCents += ord.merchantNetCents;
    courierPayablesCents += ord.courierEarningsCents;
  }

  const gmvVsRevenueNoticeText = translateMessage("finance.gmv_vs_revenue.notice", locale, {
    gmv: formatBrlCents(gmvCents, locale),
    netRevenue: formatBrlCents(netPlatformRevenueCents, locale),
  });

  const reconciliationRun = params.pspReportedCaptures
    ? evaluatePspReconciliationRun({
        runId: `recon_${Date.now()}`,
        providerCode: "stripe",
        runDate: new Date().toISOString().slice(0, 10),
        expectedOrders: params.orders.map((o) => ({ orderId: o.id, totalCents: o.totalCents })),
        pspReportedCaptures: params.pspReportedCaptures,
      })
    : null;

  let settlementResult: SettlementRecordContract | null = null;
  let settlementNoticeText: string | null = null;

  if (params.settlementToExecute) {
    const providers = inspectProviderReadiness(params.env ?? {});
    const psp = providers.find((p) => p.providerCode === params.settlementToExecute?.providerCode);
    const pspStatus = psp?.status ?? "BLOCKED_MISSING_CREDENTIALS";

    settlementResult = evaluateSettlementPayoutExecution({
      settlement: params.settlementToExecute.settlement,
      actorId: params.actor.id,
      actorAal: params.actor.aal,
      actorRoles: params.actor.staffScopes.map((s) => s.role),
      bankAccountApprovedByActorId:
        params.settlementToExecute.bankAccountApprovedByActorId ?? null,
      pspProviderStatus: pspStatus,
      externalPayoutReference: params.settlementToExecute.externalPayoutReference ?? null,
    });

    if (settlementResult.status === "BLOCKED_NO_PSP") {
      settlementNoticeText = translateMessage("finance.payout.blocked_no_psp", locale, {
        settlementId: settlementResult.id,
        amount: formatBrlCents(settlementResult.amountCents, locale),
        providerCode: params.settlementToExecute.providerCode,
      });
    }
  }

  return {
    authorized: true,
    banner: null,
    gmvCents,
    netPlatformRevenueCents,
    merchantPayablesCents,
    courierPayablesCents,
    gmvVsRevenueNoticeText,
    reconciliationRun,
    settlementResult,
    settlementNoticeText,
  };
}

// ============================================================================
// M14: Logistics & Dispatch Operational Console
// ============================================================================

export interface LogisticsDispatchConsoleModel {
  authorized: boolean;
  mapsProviderStatus: ExternalProviderDescriptor["status"];
  mapsFallbackNoticeText: string | null;
  tasks: readonly DeliveryTaskContract[];
}

/**
 * Builds the M14 Logistics & Dispatch Operational Console model, rendering an explicit
 * Haversine distance/ETA fallback notice when Google Maps / Mapbox credentials are absent.
 */
export function buildLogisticsDispatchConsoleModel(params: {
  actor: AuthenticatedActorProfileContract;
  tasks: readonly DeliveryTaskContract[];
  mapsProviderCode?: "google_maps" | "mapbox";
  env?: Record<string, string | undefined>;
  locale?: SupportedLocale;
}): LogisticsDispatchConsoleModel {
  const locale = params.locale ?? params.actor.preferredLocale ?? DEFAULT_LOCALE;
  const decision = authorizeStaffAction({
    actor: params.actor,
    allowedRoles: ["operations", "tech_admin"],
    requireMfaAal2: true,
  });

  if (!decision.allowed) {
    return {
      authorized: false,
      mapsProviderStatus: "BLOCKED_MISSING_CREDENTIALS",
      mapsFallbackNoticeText: null,
      tasks: [],
    };
  }

  const providerCode = params.mapsProviderCode ?? "google_maps";
  const providers = inspectProviderReadiness(params.env ?? {});
  const mapsProvider = providers.find((p) => p.providerCode === providerCode);
  const status = mapsProvider?.status ?? "BLOCKED_MISSING_CREDENTIALS";

  const firstTask = params.tasks[0];
  const mapsFallbackNoticeText =
    status === "BLOCKED_MISSING_CREDENTIALS"
      ? translateMessage("logistics.maps.fallback_notice", locale, {
          providerCode,
          distance: firstTask?.distanceMeters ?? 1420,
          eta: firstTask?.estimatedEtaMinutes ?? 18,
        })
      : null;

  return {
    authorized: true,
    mapsProviderStatus: status,
    mapsFallbackNoticeText,
    tasks: params.tasks,
  };
}

// ============================================================================
// M15: Fleet & Logistics Operator Portal Model
// ============================================================================

export function buildFleetOperatorPortalModel(params: {
  fleetOrganizationId: string;
  actorOrganizationIds: readonly string[];
  isFleetContractApproved: boolean;
  couriers: ReadonlyArray<{
    courierId: string;
    courierName: string;
    fleetOrganizationId: string | null;
  }>;
}): {
  portalStatus:
    | "ACTIVE"
    | "DISABLED_PENDING_FLEET_CONTRACT"
    | "DENIED_CROSS_FLEET_OR_INDEPENDENT_COURIER";
  visibleCouriers: ReadonlyArray<{
    courierId: string;
    courierName: string;
    fleetOrganizationId: string | null;
  }>;
} {
  if (!params.isFleetContractApproved) {
    return {
      portalStatus: "DISABLED_PENDING_FLEET_CONTRACT",
      visibleCouriers: [],
    };
  }

  if (!params.actorOrganizationIds.includes(params.fleetOrganizationId)) {
    return {
      portalStatus: "DENIED_CROSS_FLEET_OR_INDEPENDENT_COURIER",
      visibleCouriers: [],
    };
  }

  const visibleCouriers = params.couriers.filter((c) => {
    const check = evaluateFleetOperatorAccess({
      fleetOrganizationId: params.fleetOrganizationId,
      actorOrganizationIds: params.actorOrganizationIds,
      targetCourierFleetOrgId: c.fleetOrganizationId,
      isFleetContractApproved: params.isFleetContractApproved,
    });
    return check.allowed;
  });

  return {
    portalStatus: "ACTIVE",
    visibleCouriers,
  };
}

// ============================================================================
// M17: Customer/Partner/Courier Support, SLA & Escalated Refunds Console Model
// ============================================================================

export interface SupportBackofficeConsoleModel {
  authorized: boolean;
  canApproveEscalatedFinance: boolean;
  autoRefundLimitCents: number;
  autoRefundLimitFormatted: string;
  cases: readonly SupportCaseContract[];
  messages: readonly SupportMessageContract[];
  attachments: readonly SupportAttachmentContract[];
  actionRequests: readonly SupportActionRequestContract[];
  pendingFinanceCount: number;
  criticalInRouteCount: number;
}

export function buildSupportBackofficeConsoleModel(params: {
  actor: AuthenticatedActorProfileContract;
  overview: SupportBackofficeOverviewContract;
  locale?: SupportedLocale;
}): SupportBackofficeConsoleModel {
  const locale = params.locale ?? params.actor.preferredLocale ?? DEFAULT_LOCALE;
  const decision = authorizeStaffAction({
    actor: params.actor,
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

  if (!decision.allowed) {
    return {
      authorized: false,
      canApproveEscalatedFinance: false,
      autoRefundLimitCents: params.overview.autoRefundLimitCents,
      autoRefundLimitFormatted: formatBrlCents(params.overview.autoRefundLimitCents, locale),
      cases: [],
      messages: [],
      attachments: [],
      actionRequests: [],
      pendingFinanceCount: 0,
      criticalInRouteCount: 0,
    };
  }

  const financeDecision = authorizeStaffAction({
    actor: params.actor,
    allowedRoles: ["finance", "tech_admin"],
    requireMfaAal2: true,
  });

  return {
    authorized: true,
    canApproveEscalatedFinance: financeDecision.allowed,
    autoRefundLimitCents: params.overview.autoRefundLimitCents,
    autoRefundLimitFormatted: formatBrlCents(params.overview.autoRefundLimitCents, locale),
    cases: params.overview.cases,
    messages: params.overview.messages,
    attachments: params.overview.attachments,
    actionRequests: params.overview.actionRequests,
    pendingFinanceCount: params.overview.actionRequests.filter(
      (r) => r.status === "PENDING_FINANCE"
    ).length,
    criticalInRouteCount: params.overview.cases.filter(
      (c) => c.priority === "CRITICAL_IN_ROUTE" || c.priority === "CRITICAL"
    ).length,
  };
}

// ============================================================================
// M18: Commercial Leads, Proposals, Contracts & Onboarding Console Model
// ============================================================================

export interface CommercialBackofficeConsoleModel {
  authorized: boolean;
  canMutateFinanceOrBankAccounts: boolean;
  legalTemplateNotice: string;
  segregationNotice: string;
  leads: readonly CommercialLeadContract[];
  proposals: readonly CommercialProposalContract[];
  contracts: readonly MerchantContractRecordContract[];
  commissionRuleVersions: readonly CommissionRuleVersionContract[];
  activeCommissionRulesCount: number;
}

export function buildCommercialBackofficeConsoleModel(params: {
  actor: AuthenticatedActorProfileContract;
  overview: CommercialBackofficeOverviewContract;
  locale?: SupportedLocale;
}): CommercialBackofficeConsoleModel {
  const locale = params.locale ?? params.actor.preferredLocale ?? DEFAULT_LOCALE;
  const decision = authorizeStaffAction({
    actor: params.actor,
    allowedRoles: ["commercial", "operations", "tech_admin"],
    requireMfaAal2: false,
  });

  const financeDecision = authorizeStaffAction({
    actor: params.actor,
    allowedRoles: ["finance", "tech_admin"],
    requireMfaAal2: true,
  });

  const legalTemplateNotice = translateMessage(
    "commercial.legal_template.pending_notice",
    locale
  );
  const segregationNotice = translateMessage(
    "commercial.segregation.finance_blocked_notice",
    locale
  );

  if (!decision.allowed) {
    return {
      authorized: false,
      canMutateFinanceOrBankAccounts: false,
      legalTemplateNotice,
      segregationNotice,
      leads: [],
      proposals: [],
      contracts: [],
      commissionRuleVersions: [],
      activeCommissionRulesCount: 0,
    };
  }

  return {
    authorized: true,
    canMutateFinanceOrBankAccounts: financeDecision.allowed,
    legalTemplateNotice,
    segregationNotice,
    leads: params.overview.leads,
    proposals: params.overview.proposals,
    contracts: params.overview.contracts,
    commissionRuleVersions: params.overview.commissionRuleVersions,
    activeCommissionRulesCount: params.overview.commissionRuleVersions.filter(
      (r) => r.effectiveUntilIso === null
    ).length,
  };
}

export * from "./app/layout.js";
export * from "./app/admin/page.js";
export * from "./app/finance/page.js";
export * from "./app/logistics/page.js";
export * from "./app/fleets/page.js";
export * from "./app/support/page.js";
export * from "./app/commercial/page.js";
export * from "./server.js";

