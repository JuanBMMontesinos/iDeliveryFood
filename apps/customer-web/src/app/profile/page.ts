import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  formatOperationalTimestamp,
  translateMessage,
  type AuthenticatedActorProfileContract,
  type SupportedLocale,
  type UserDeviceContract,
} from "@ideliveryfood/contracts";
import { buildUiScreenStateBanner, type UiScreenStateBanner } from "@ideliveryfood/ui-web";
import { escapeHtml, renderCustomerAppShellHtml } from "../layout.js";

export interface CustomerProfileScreenModel {
  title: string;
  locale: SupportedLocale;
  banner: UiScreenStateBanner | null;
  profile: AuthenticatedActorProfileContract | null;
  devices: UserDeviceContract[];
}

export async function loadCustomerProfileScreen(params: {
  apiClient: IDeliveryApiClient;
  locale?: SupportedLocale;
  isOffline?: boolean;
}): Promise<CustomerProfileScreenModel> {
  const locale = params.locale ?? params.apiClient.getLocale() ?? DEFAULT_LOCALE;
  params.apiClient.setLocale(locale);
  const title = translateMessage("customer.profile.title", locale);

  if (params.isOffline) {
    return {
      title,
      locale,
      banner: buildUiScreenStateBanner({ kind: "offline", locale }),
      profile: null,
      devices: [],
    };
  }

  try {
    const [meRes, devicesRes] = await Promise.all([
      params.apiClient.getMe(),
      params.apiClient.listMyDevices(),
    ]);
    return {
      title,
      locale,
      banner: null,
      profile: meRes.data,
      devices: devicesRes.data,
    };
  } catch (err) {
    const errorCode = err instanceof IDeliveryApiError ? err.envelope.error.code : "NETWORK_ERROR";
    const correlationId = err instanceof IDeliveryApiError ? err.envelope.error.correlationId : "N/A";
    return {
      title,
      locale,
      banner: buildUiScreenStateBanner({ kind: "error", locale, errorCode, correlationId }),
      profile: null,
      devices: [],
    };
  }
}

export function renderCustomerProfileHtml(model: CustomerProfileScreenModel): string {
  const isPt = model.locale === "pt-BR";
  if (!model.profile) {
    return renderCustomerAppShellHtml({
      locale: model.locale,
      pageTitle: model.title,
      activePath: "/profile",
      banner: model.banner,
      mainContentHtml: `<section class="card"><h1>${escapeHtml(model.title)}</h1></section>`,
    });
  }

  const devicesHtml = model.devices
    .map(
      (dev) => `
      <li class="card">
        <strong>${escapeHtml(dev.platform)} — ${escapeHtml(dev.deviceIdentifier)}</strong>
        <span class="badge">${dev.isRevoked ? (isPt ? "Revogado" : "Revoked") : isPt ? "Ativo" : "Active"}</span>
        <div><small>${isPt ? "Último acesso" : "Last seen"}: ${escapeHtml(formatOperationalTimestamp(dev.lastSeenAtIso, model.locale))}</small></div>
      </li>`
    )
    .join("");

  const mainContentHtml = `
    <section aria-labelledby="profile-heading">
      <h1 id="profile-heading">${escapeHtml(model.title)}</h1>
      <div class="card">
        <p><strong>${isPt ? "Nome" : "Name"}:</strong> ${escapeHtml(model.profile.fullName)}</p>
        <p><strong>E-mail:</strong> ${escapeHtml(model.profile.email)}</p>
        <p><strong>${isPt ? "Idioma Preferido" : "Preferred Language"}:</strong> ${escapeHtml(model.profile.preferredLocale)}</p>
        <p><strong>MFA:</strong> ${escapeHtml(model.profile.aal)}</p>
      </div>
      <h2>${isPt ? "Sessões e Dispositivos Conectados" : "Connected Sessions & Devices"}</h2>
      <ul style="list-style:none;padding:0;">${devicesHtml}</ul>
      <div class="card">
        <h2>${isPt ? "Direitos do Titular LGPD" : "LGPD Privacy Rights"}</h2>
        <p>${isPt ? "Solicite exportação de dados ou exclusão de conta (sujeita à verificação de retenção legal)." : "Request data portability export or account deletion (subject to statutory retention check)."}</p>
      </div>
    </section>
  `;

  return renderCustomerAppShellHtml({
    locale: model.locale,
    pageTitle: model.title,
    activePath: "/profile",
    banner: model.banner,
    mainContentHtml,
  });
}
