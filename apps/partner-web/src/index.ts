import { authorizePartnerScope } from "@ideliveryfood/authz";
import {
  DEFAULT_LOCALE,
  translateMessage,
  type AuthenticatedActorProfileContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
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
