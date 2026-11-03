import { authorizeStaffAction } from "@ideliveryfood/authz";
import { inspectProviderReadiness, type ExternalProviderDescriptor } from "@ideliveryfood/config";
import {
  DEFAULT_LOCALE,
  translateMessage,
  type AuthenticatedActorProfileContract,
  type StaffRole,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
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
