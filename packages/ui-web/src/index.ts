import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  formatBrlCents,
  translateMessage,
  type PublishedStoreContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";

export type UiScreenStateKind =
  | "loading"
  | "empty"
  | "error"
  | "offline"
  | "forbidden"
  | "mfa_required"
  | "ready";

export interface UiScreenStateBanner {
  kind: UiScreenStateKind;
  role: "status" | "alert";
  ariaLive: "polite" | "assertive";
  message: string;
}

/**
 * Generates accessible (WCAG 2.1 AA) status/alert descriptors for all mandatory UI states
 * in the active locale ('en' default, 'pt-BR' switchable).
 */
export function buildUiScreenStateBanner(params: {
  kind: Exclude<UiScreenStateKind, "ready">;
  locale?: SupportedLocale;
  errorCode?: string;
  correlationId?: string;
}): UiScreenStateBanner {
  const locale = params.locale ?? DEFAULT_LOCALE;
  switch (params.kind) {
    case "loading":
      return {
        kind: "loading",
        role: "status",
        ariaLive: "polite",
        message: translateMessage("app.state.loading", locale),
      };
    case "empty":
      return {
        kind: "empty",
        role: "status",
        ariaLive: "polite",
        message: translateMessage("app.state.empty", locale),
      };
    case "offline":
      return {
        kind: "offline",
        role: "alert",
        ariaLive: "assertive",
        message: translateMessage("app.state.offline", locale),
      };
    case "forbidden":
      return {
        kind: "forbidden",
        role: "alert",
        ariaLive: "assertive",
        message: translateMessage("app.state.forbidden", locale),
      };
    case "mfa_required":
      return {
        kind: "mfa_required",
        role: "alert",
        ariaLive: "assertive",
        message: translateMessage("app.state.mfa_required", locale),
      };
    case "error":
      return {
        kind: "error",
        role: "alert",
        ariaLive: "assertive",
        message: translateMessage("app.state.error", locale, {
          code: params.errorCode ?? "UNKNOWN_ERROR",
          correlationId: params.correlationId ?? "N/A",
        }),
      };
  }
}

export interface LanguageSelectorViewModel {
  label: string;
  activeLocale: SupportedLocale;
  options: Array<{
    code: SupportedLocale;
    displayLabel: string;
    isSelected: boolean;
  }>;
}

export function buildLanguageSelectorViewModel(
  activeLocale: SupportedLocale = DEFAULT_LOCALE
): LanguageSelectorViewModel {
  return {
    label: translateMessage("app.locale.selector_label", activeLocale),
    activeLocale,
    options: SUPPORTED_LOCALES.map((code) => ({
      code,
      displayLabel:
        code === "en"
          ? translateMessage("app.locale.en", activeLocale)
          : translateMessage("app.locale.pt_br", activeLocale),
      isSelected: code === activeLocale,
    })),
  };
}

export interface LocalizedStoreCardViewModel {
  id: string;
  slug: string;
  name: string;
  description: string;
  minOrderFormatted: string;
  prepTimeFormatted: string;
  modalityBadges: string[];
}

/**
 * Formats a live store contract returned from Supabase/API into a localized card view model.
 * Never invents or hardcodes store data.
 */
export function mapStoreToLocalizedCard(
  store: PublishedStoreContract,
  locale: SupportedLocale = DEFAULT_LOCALE
): LocalizedStoreCardViewModel {
  const description = locale === "pt-BR" ? store.descriptionPtBr : store.descriptionEn;
  const minOrderAmount = formatBrlCents(store.minOrderCents, locale);

  return {
    id: store.id,
    slug: store.slug,
    name: store.name,
    description,
    minOrderFormatted: translateMessage("marketplace.stores.min_order", locale, {
      amount: minOrderAmount,
    }),
    prepTimeFormatted: translateMessage("marketplace.stores.prep_time", locale, {
      min: store.prepTimeMinMinutes,
      max: store.prepTimeMaxMinutes,
    }),
    modalityBadges: store.supportedModalities.map((m) => {
      if (m === "PLATFORM_DELIVERY") {
        return translateMessage("marketplace.modality.platform_delivery", locale);
      }
      if (m === "MERCHANT_DELIVERY") {
        return translateMessage("marketplace.modality.merchant_delivery", locale);
      }
      return translateMessage("marketplace.modality.pickup", locale);
    }),
  };
}
