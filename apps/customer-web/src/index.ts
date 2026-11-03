import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  translateMessage,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  buildLanguageSelectorViewModel,
  buildUiScreenStateBanner,
  mapStoreToLocalizedCard,
  type LanguageSelectorViewModel,
  type LocalizedStoreCardViewModel,
  type UiScreenStateBanner,
} from "@ideliveryfood/ui-web";

export interface CustomerMarketplaceScreenModel {
  brandTitle: string;
  heading: string;
  localeSelector: LanguageSelectorViewModel;
  banner: UiScreenStateBanner | null;
  stores: LocalizedStoreCardViewModel[];
}

/**
 * Loads the Customer Web Marketplace discovery screen exclusively from the live /v1/stores API
 * (backed by Supabase published_stores_v). Never uses hardcoded store arrays.
 */
export async function loadCustomerMarketplaceScreen(params: {
  apiClient: IDeliveryApiClient;
  locale?: SupportedLocale;
  isOffline?: boolean;
}): Promise<CustomerMarketplaceScreenModel> {
  const locale = params.locale ?? params.apiClient.getLocale() ?? DEFAULT_LOCALE;
  params.apiClient.setLocale(locale);

  const localeSelector = buildLanguageSelectorViewModel(locale);
  const brandTitle = `${translateMessage("app.brand.name", locale)} — ${translateMessage("app.brand.tagline", locale)}`;

  if (params.isOffline) {
    return {
      brandTitle,
      heading: translateMessage("marketplace.stores.heading", locale, { count: 0 }),
      localeSelector,
      banner: buildUiScreenStateBanner({ kind: "offline", locale }),
      stores: [],
    };
  }

  try {
    const response = await params.apiClient.listPublishedStores();
    const cards = response.data.map((store) => mapStoreToLocalizedCard(store, locale));

    return {
      brandTitle,
      heading: translateMessage("marketplace.stores.heading", locale, {
        count: cards.length,
      }),
      localeSelector,
      banner: cards.length === 0 ? buildUiScreenStateBanner({ kind: "empty", locale }) : null,
      stores: cards,
    };
  } catch (err) {
    const errorCode = err instanceof IDeliveryApiError ? err.envelope.error.code : "NETWORK_ERROR";
    const correlationId =
      err instanceof IDeliveryApiError ? err.envelope.error.correlationId : "N/A";
    return {
      brandTitle,
      heading: translateMessage("marketplace.stores.heading", locale, { count: 0 }),
      localeSelector,
      banner: buildUiScreenStateBanner({
        kind: "error",
        locale,
        errorCode,
        correlationId,
      }),
      stores: [],
    };
  }
}
