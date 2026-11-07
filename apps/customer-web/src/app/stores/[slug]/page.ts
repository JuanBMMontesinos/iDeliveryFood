import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  formatBrlCents,
  translateMessage,
  type CatalogOptionGroupContract,
  type CatalogProductContract,
  type StoreDetailResponseContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { buildUiScreenStateBanner, type UiScreenStateBanner } from "@ideliveryfood/ui-web";
import { escapeHtml, renderCustomerAppShellHtml } from "../../layout.js";

export interface CustomerStoreDetailScreenModel {
  locale: SupportedLocale;
  banner: UiScreenStateBanner | null;
  detail: StoreDetailResponseContract | null;
  availabilityBadge: string;
}

export interface ProductOptionSelectionValidationResult {
  valid: boolean;
  violatedGroupId: string | null;
  message: string | null;
}

/**
 * Validates customer product customization selections against each option group's minSelections and maxSelections (M04/M05).
 */
export function validateCustomerProductOptionSelections(params: {
  product: CatalogProductContract;
  selectedOptions: Array<{ optionGroupId: string; optionId: string; quantity: number }>;
  locale?: SupportedLocale;
}): ProductOptionSelectionValidationResult {
  const locale = params.locale ?? DEFAULT_LOCALE;
  for (const group of params.product.optionGroups) {
    const totalInGroup = params.selectedOptions
      .filter((s) => s.optionGroupId === group.id)
      .reduce((acc, s) => acc + s.quantity, 0);

    if (totalInGroup < group.minSelections || totalInGroup > group.maxSelections) {
      const msg =
        group.minSelections > 0
          ? translateMessage("catalog.option_group.required", locale, {
              min: group.minSelections,
              max: group.maxSelections,
            })
          : translateMessage("catalog.option_group.optional", locale, {
              max: group.maxSelections,
            });
      return {
        valid: false,
        violatedGroupId: group.id,
        message: `${group.localizedName}: ${msg}`,
      };
    }
  }
  return {
    valid: true,
    violatedGroupId: null,
    message: null,
  };
}

export async function loadCustomerStoreDetailScreen(params: {
  apiClient: IDeliveryApiClient;
  storeIdOrSlug: string;
  locale?: SupportedLocale;
  isOffline?: boolean;
}): Promise<CustomerStoreDetailScreenModel> {
  const locale = params.locale ?? params.apiClient.getLocale() ?? DEFAULT_LOCALE;
  params.apiClient.setLocale(locale);

  if (params.isOffline) {
    return {
      locale,
      banner: buildUiScreenStateBanner({ kind: "offline", locale }),
      detail: null,
      availabilityBadge: translateMessage("app.state.offline", locale),
    };
  }

  try {
    const response = await params.apiClient.getStoreDetail(params.storeIdOrSlug);
    const detail = response.data;
    const availabilityBadge = detail.store.isPaused
      ? translateMessage("marketplace.store.paused", locale)
      : detail.availability.isOpen
        ? translateMessage("marketplace.store.open", locale)
        : translateMessage("marketplace.store.closed", locale, {
            reason: detail.availability.reasonCode,
          });

    return {
      locale,
      banner:
        detail.categories.length === 0
          ? buildUiScreenStateBanner({ kind: "empty", locale })
          : null,
      detail,
      availabilityBadge,
    };
  } catch (err) {
    const errorCode = err instanceof IDeliveryApiError ? err.envelope.error.code : "NETWORK_ERROR";
    const correlationId = err instanceof IDeliveryApiError ? err.envelope.error.correlationId : "N/A";
    return {
      locale,
      banner: buildUiScreenStateBanner({ kind: "error", locale, errorCode, correlationId }),
      detail: null,
      availabilityBadge: errorCode,
    };
  }
}

function renderOptionGroupHtml(group: CatalogOptionGroupContract, locale: SupportedLocale): string {
  const ruleLabel =
    group.minSelections > 0
      ? translateMessage("catalog.option_group.required", locale, {
          min: group.minSelections,
          max: group.maxSelections,
        })
      : translateMessage("catalog.option_group.optional", locale, {
          max: group.maxSelections,
        });
  const optionsHtml = group.options
    .map(
      (opt) =>
        `<li>${escapeHtml(opt.localizedName)} (+${escapeHtml(formatBrlCents(opt.additionalPriceCents, locale))})</li>`
    )
    .join("");
  return `<div style="margin-top:0.5rem;">
    <strong>${escapeHtml(group.localizedName)}</strong> <small>(${escapeHtml(ruleLabel)})</small>
    <ul>${optionsHtml}</ul>
  </div>`;
}

export function renderCustomerStoreDetailHtml(model: CustomerStoreDetailScreenModel): string {
  const detail = model.detail;
  if (!detail) {
    return renderCustomerAppShellHtml({
      locale: model.locale,
      pageTitle: "Store",
      activePath: "/stores",
      banner: model.banner,
      mainContentHtml: `<section class="card"><p>${escapeHtml(model.availabilityBadge)}</p></section>`,
    });
  }

  const categoriesHtml = detail.categories
    .map((cat) => {
      const productsHtml = cat.products
        .map(
          (prod) => `
          <article class="card" aria-labelledby="prod-${escapeHtml(prod.id)}">
            <h3 id="prod-${escapeHtml(prod.id)}">${escapeHtml(prod.localizedName)} — ${escapeHtml(formatBrlCents(prod.priceCents, model.locale))}</h3>
            <p>${escapeHtml(prod.localizedDescription)}</p>
            ${
              !prod.isAvailable || prod.isPaused
                ? `<span class="badge">${escapeHtml(translateMessage("catalog.product.unavailable", model.locale))}</span>`
                : ""
            }
            ${prod.optionGroups.map((g) => renderOptionGroupHtml(g, model.locale)).join("")}
          </article>`
        )
        .join("");
      return `<section aria-labelledby="cat-${escapeHtml(cat.id)}">
        <h2 id="cat-${escapeHtml(cat.id)}">${escapeHtml(cat.localizedName)}</h2>
        ${productsHtml}
      </section>`;
    })
    .join("");

  const mainContentHtml = `
    <header class="card">
      <h1>${escapeHtml(detail.store.name)}</h1>
      <p>${escapeHtml(detail.store.localizedDescription)}</p>
      <span class="badge">${escapeHtml(model.availabilityBadge)}</span>
      <span class="badge">${escapeHtml(
        translateMessage("marketplace.stores.min_order", model.locale, {
          amount: formatBrlCents(detail.store.minOrderCents, model.locale),
        })
      )}</span>
    </header>
    ${categoriesHtml}
  `;

  return renderCustomerAppShellHtml({
    locale: model.locale,
    pageTitle: detail.store.name,
    activePath: `/stores/${detail.store.slug}`,
    banner: model.banner,
    mainContentHtml,
  });
}
