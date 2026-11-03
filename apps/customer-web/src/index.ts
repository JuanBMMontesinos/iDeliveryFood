import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import type { ExternalProviderDescriptor } from "@ideliveryfood/config";
import {
  DEFAULT_LOCALE,
  formatBrlCents,
  formatOperationalTimestamp,
  translateMessage,
  type CartItemSelectionContract,
  type ServerQuoteRecordContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { evaluateSingleStoreCartAddition } from "@ideliveryfood/domain";
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
  search?: string;
  cuisineCategory?: string;
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
    const filterArgs: { search?: string; cuisineCategory?: string } = {};
    if (params.search) filterArgs.search = params.search;
    if (params.cuisineCategory) filterArgs.cuisineCategory = params.cuisineCategory;

    const response = await params.apiClient.listPublishedStores(filterArgs);
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

export interface CartSwitchConfirmationDialogModel {
  title: string;
  body: string;
  currentStoreId: string;
  targetStoreId: string;
}

/**
 * Single-store cart state manager for Customer Web (M05).
 * Requires explicit confirmation before replacing a basket from another store.
 */
export class CustomerCartController {
  private storeId: string | null = null;
  private storeName: string | null = null;
  private items: CartItemSelectionContract[] = [];

  public getState(): {
    storeId: string | null;
    storeName: string | null;
    items: readonly CartItemSelectionContract[];
  } {
    return {
      storeId: this.storeId,
      storeName: this.storeName,
      items: this.items,
    };
  }

  public addItem(params: {
    targetStoreId: string;
    targetStoreName: string;
    item: CartItemSelectionContract;
    confirmSwitchStore?: boolean;
    locale?: SupportedLocale;
  }): {
    added: boolean;
    confirmationDialog: CartSwitchConfirmationDialogModel | null;
  } {
    const locale = params.locale ?? DEFAULT_LOCALE;
    const evaluation = evaluateSingleStoreCartAddition({
      currentStoreId: this.storeId,
      currentItems: this.items,
      targetStoreId: params.targetStoreId,
      itemToAdd: params.item,
      confirmSwitchStore: params.confirmSwitchStore ?? false,
    });

    if (!evaluation.allowed && evaluation.requiresConfirmation) {
      return {
        added: false,
        confirmationDialog: {
          title: translateMessage("cart.switch_store.confirm_title", locale, {
            newStoreName: params.targetStoreName,
          }),
          body: translateMessage("cart.switch_store.confirm_body", locale, {
            currentStoreName: this.storeName ?? this.storeId ?? "",
          }),
          currentStoreId: this.storeId ?? "",
          targetStoreId: params.targetStoreId,
        },
      };
    }

    this.storeId = evaluation.nextStoreId;
    this.storeName = params.targetStoreName;
    this.items = evaluation.nextItems;
    return {
      added: true,
      confirmationDialog: null,
    };
  }
}

export interface CustomerCheckoutScreenModel {
  quoteId: string;
  isQuoteExpired: boolean;
  quoteExpiredNotice: string | null;
  subtotalFormatted: string;
  addonsFormatted: string;
  serviceFeeFormatted: string;
  deliveryFeeFormatted: string;
  discountFormatted: string;
  totalFormatted: string;
  totalLabel: string;
  canSubmitPayment: boolean;
  pspBlockedNotice: string | null;
}

/**
 * Builds the Customer Checkout screen model from an authoritative server quote and PSP readiness report (M05/M12).
 * Honestly blocks payment submission when PSP credentials are not configured.
 */
export function buildCustomerCheckoutScreenModel(params: {
  quote: ServerQuoteRecordContract;
  pspReadiness: ExternalProviderDescriptor;
  locale?: SupportedLocale;
  now?: Date;
}): CustomerCheckoutScreenModel {
  const locale = params.locale ?? DEFAULT_LOCALE;
  const now = params.now ?? new Date();
  const isQuoteExpired = new Date(params.quote.expiresAtIso).getTime() <= now.getTime();

  const quoteExpiredNotice = isQuoteExpired
    ? translateMessage("checkout.quote.expired", locale, {
        expiresAt: formatOperationalTimestamp(params.quote.expiresAtIso, locale),
      })
    : null;

  const isPspBlocked =
    params.pspReadiness.status === "BLOCKED_MISSING_CREDENTIALS" ||
    params.pspReadiness.status === "DISABLED";

  const pspBlockedNotice = isPspBlocked
    ? translateMessage("checkout.psp.blocked_notice", locale, {
        providerCode: params.pspReadiness.providerCode,
        missingVars: params.pspReadiness.missingEnvVars.join(", "),
      })
    : null;

  const totalFormatted = formatBrlCents(params.quote.totalCents, locale);

  return {
    quoteId: params.quote.id,
    isQuoteExpired,
    quoteExpiredNotice,
    subtotalFormatted: formatBrlCents(params.quote.subtotalCents, locale),
    addonsFormatted: formatBrlCents(params.quote.addonsCents, locale),
    serviceFeeFormatted: formatBrlCents(params.quote.serviceFeeCents, locale),
    deliveryFeeFormatted: formatBrlCents(params.quote.deliveryFeeCents, locale),
    discountFormatted: formatBrlCents(params.quote.discountCents, locale),
    totalFormatted,
    totalLabel: translateMessage("checkout.total.label", locale, { amount: totalFormatted }),
    canSubmitPayment: !isQuoteExpired && !isPspBlocked,
    pspBlockedNotice,
  };
}
