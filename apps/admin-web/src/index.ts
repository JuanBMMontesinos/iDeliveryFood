import { authorizeStaffAction } from "@ideliveryfood/authz";
import { inspectProviderReadiness, type ExternalProviderDescriptor } from "@ideliveryfood/config";
import {
  DEFAULT_LOCALE,
  translateMessage,
  type AdminGovernanceActionContract,
  type AdminStaffScopeGrantRequestContract,
  type AuthenticatedActorProfileContract,
  type StaffRole,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  evaluateAdminGovernanceDecision,
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
