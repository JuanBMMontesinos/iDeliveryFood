import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  formatBrlCents,
  translateMessage,
  type CustomerAddressContract,
  type FulfillmentModality,
  type ServiceAreaEligibilityContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { buildUiScreenStateBanner, type UiScreenStateBanner } from "@ideliveryfood/ui-web";
import { escapeHtml, renderCustomerAppShellHtml } from "../layout.js";

export interface CustomerAddressesScreenModel {
  title: string;
  locale: SupportedLocale;
  banner: UiScreenStateBanner | null;
  addresses: CustomerAddressContract[];
  selectedAddress: CustomerAddressContract | null;
  coverageEvaluation: ServiceAreaEligibilityContract | null;
}

export async function loadCustomerAddressesScreen(params: {
  apiClient: IDeliveryApiClient;
  locale?: SupportedLocale;
  targetStoreId?: string;
  fulfillmentModality?: FulfillmentModality;
  basketCents?: number;
  isOffline?: boolean;
}): Promise<CustomerAddressesScreenModel> {
  const locale = params.locale ?? params.apiClient.getLocale() ?? DEFAULT_LOCALE;
  params.apiClient.setLocale(locale);
  const title = translateMessage("customer.addresses.title", locale);

  if (params.isOffline) {
    return {
      title,
      locale,
      banner: buildUiScreenStateBanner({ kind: "offline", locale }),
      addresses: [],
      selectedAddress: null,
      coverageEvaluation: null,
    };
  }

  try {
    const res = await params.apiClient.listMyAddresses();
    const addresses = res.data;
    const selectedAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;

    let coverageEvaluation: ServiceAreaEligibilityContract | null = null;
    if (params.targetStoreId && selectedAddress) {
      const avail = await params.apiClient.evaluateStoreAvailabilityAndCoverage({
        storeId: params.targetStoreId,
        customerLatitude: selectedAddress.latitude,
        customerLongitude: selectedAddress.longitude,
        fulfillmentModality: params.fulfillmentModality ?? "PLATFORM_DELIVERY",
        grossMerchandiseCents: params.basketCents ?? 0,
      });
      coverageEvaluation = avail.data.coverage;
    }

    return {
      title,
      locale,
      banner: addresses.length === 0 ? buildUiScreenStateBanner({ kind: "empty", locale }) : null,
      addresses,
      selectedAddress,
      coverageEvaluation,
    };
  } catch (err) {
    const errorCode = err instanceof IDeliveryApiError ? err.envelope.error.code : "NETWORK_ERROR";
    const correlationId = err instanceof IDeliveryApiError ? err.envelope.error.correlationId : "N/A";
    return {
      title,
      locale,
      banner: buildUiScreenStateBanner({ kind: "error", locale, errorCode, correlationId }),
      addresses: [],
      selectedAddress: null,
      coverageEvaluation: null,
    };
  }
}

export function renderCustomerAddressesHtml(model: CustomerAddressesScreenModel): string {
  const isPt = model.locale === "pt-BR";
  const listHtml = model.addresses
    .map(
      (addr) => `
      <li class="card">
        <strong>${escapeHtml(addr.label)}</strong> ${addr.isDefault ? `<span class="badge">${isPt ? "Padrão" : "Default"}</span>` : ""}
        <div>${escapeHtml(addr.streetLine)}, ${escapeHtml(addr.number)}${addr.complement ? ` - ${escapeHtml(addr.complement)}` : ""}</div>
        <div>${escapeHtml(addr.neighborhood)} — ${escapeHtml(addr.city)}/${escapeHtml(addr.stateCode)} (${escapeHtml(addr.postalCode)})</div>
        <small>GPS: ${addr.latitude.toFixed(6)}, ${addr.longitude.toFixed(6)}</small>
      </li>`
    )
    .join("");

  const coverageHtml = model.coverageEvaluation
    ? `<div class="card" role="status" aria-live="polite">
        ${
          model.coverageEvaluation.eligible
            ? `${isPt ? "Área atendida" : "Service area covered"} (${model.coverageEvaluation.distanceMeters}m) — ${formatBrlCents(model.coverageEvaluation.deliveryFeeCents, model.locale)}`
            : escapeHtml(
                translateMessage("marketplace.store.out_of_range", model.locale, {
                  distance: model.coverageEvaluation.distanceMeters,
                })
              )
        }
      </div>`
    : "";

  const mainContentHtml = `
    <section aria-labelledby="addresses-heading">
      <h1 id="addresses-heading">${escapeHtml(model.title)}</h1>
      ${coverageHtml}
      <ul style="list-style:none;padding:0;">${listHtml}</ul>
    </section>
  `;

  return renderCustomerAppShellHtml({
    locale: model.locale,
    pageTitle: model.title,
    activePath: "/addresses",
    banner: model.banner,
    mainContentHtml,
  });
}
