import type { IDeliveryApiClient } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  type AuthenticatedActorProfileContract,
  type StoreDetailResponseContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  escapeHtml,
  formatBrlCents,
  renderPartnerLayoutHtml,
} from "../../layout.js";

export type PartnerStoreSubRoute =
  | "/store/settings"
  | "/store/hours"
  | "/store/coverage";

export interface PartnerStoreConfigurationScreenModel {
  locale: SupportedLocale;
  subRoute: PartnerStoreSubRoute;
  actor: AuthenticatedActorProfileContract;
  storeDetail: StoreDetailResponseContract;
}

export async function loadPartnerStoreConfigurationScreen(params: {
  apiClient: IDeliveryApiClient;
  storeId: string;
  subRoute?: PartnerStoreSubRoute;
  locale?: SupportedLocale;
}): Promise<PartnerStoreConfigurationScreenModel> {
  const [meRes, storeRes] = await Promise.all([
    params.apiClient.getMe(),
    params.apiClient.getStoreDetail(params.storeId),
  ]);

  const locale = params.locale ?? meRes.data.preferredLocale ?? DEFAULT_LOCALE;
  return {
    locale,
    subRoute: params.subRoute ?? "/store/settings",
    actor: meRes.data,
    storeDetail: storeRes.data,
  };
}

export function renderPartnerStoreConfigurationHtml(
  model: PartnerStoreConfigurationScreenModel
): string {
  const { locale, subRoute, actor, storeDetail } = model;
  const isPt = locale === "pt-BR";
  const store = storeDetail.store;

  const settingsCardHtml = `
    <div class="card" data-testid="store-settings-card">
      <h1 style="margin-top:0;">${isPt ? "Configurações da Loja & Pausa Operacional" : "Store Settings & Operational Pause"}</h1>
      <p><strong>${isPt ? "Nome:" : "Name:"}</strong> ${escapeHtml(store.name)}</p>
      <p><strong>${isPt ? "Descrição:" : "Description:"}</strong> ${escapeHtml(isPt ? store.descriptionPtBr : store.descriptionEn)}</p>
      <p><strong>${isPt ? "Categoria Culinária:" : "Cuisine Category:"}</strong> ${escapeHtml(store.cuisineCategory)}</p>
      <p><strong>${isPt ? "Pedido Mínimo:" : "Minimum Order:"}</strong> ${escapeHtml(formatBrlCents(store.minOrderCents, locale))}</p>
      <p><strong>${isPt ? "Tempo de Preparo Padrão:" : "Default Prep Time:"}</strong> ${store.prepTimeMinMinutes}-${store.prepTimeMaxMinutes} min</p>
      <p><strong>${isPt ? "Modalidades:" : "Modalities:"}</strong> ${escapeHtml(store.supportedModalities.join(", "))}</p>
      <p data-testid="store-pause-state">
        <strong>${isPt ? "Status de Pausa:" : "Pause Status:"}</strong>
        <span class="badge ${store.isPaused ? "badge--closed" : "badge--open"}">
          ${store.isPaused ? (isPt ? "PAUSADA" : "PAUSED") : isPt ? "RECEBENDO PEDIDOS" : "ACCEPTING ORDERS"}
        </span>
      </p>
    </div>
  `;

  const hoursCardHtml = `
    <div class="card" data-testid="store-hours-card">
      <h2 style="margin-top:0;">${isPt ? "Horários de Funcionamento (America/Sao_Paulo)" : "Operating Hours (America/Sao_Paulo)"}</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>${isPt ? "Dia da Semana (0=Dom..6=Sáb)" : "Day of Week (0=Sun..6=Sat)"}</th>
            <th>${isPt ? "Abertura" : "Opens At"}</th>
            <th>${isPt ? "Fechamento" : "Closes At"}</th>
            <th>${isPt ? "Status" : "Status"}</th>
          </tr>
        </thead>
        <tbody>
          ${storeDetail.hours
            .map(
              (h) => `
            <tr>
              <td>${h.dayOfWeek}</td>
              <td>${escapeHtml(h.opensAt)}</td>
              <td>${escapeHtml(h.closesAt)}</td>
              <td>${h.isClosed ? (isPt ? "Fechado" : "Closed") : isPt ? "Aberto" : "Open"}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>

      <h3>${isPt ? "Exceções & Feriados" : "Holiday & Schedule Exceptions"}</h3>
      <ul>
        ${storeDetail.exceptions
          .map(
            (ex) =>
              `<li><strong>${escapeHtml(ex.exceptionDate)}:</strong> ${
                ex.isClosed
                  ? isPt
                    ? "Fechado o dia todo"
                    : "Closed all day"
                  : `${escapeHtml(ex.opensAt ?? "")} - ${escapeHtml(ex.closesAt ?? "")}`
              } (${escapeHtml(ex.reason ?? "")})</li>`
          )
          .join("")}
      </ul>
    </div>
  `;

  const coverageCardHtml = `
    <div class="card" data-testid="store-coverage-card">
      <h2 style="margin-top:0;">${isPt ? "Áreas de Cobertura & Taxa de Entrega" : "Delivery Coverage & Fee Rules"}</h2>
      <p>
        <strong>${isPt ? "Coordenadas da Loja:" : "Store Coordinates:"}</strong>
        Lat ${(store.latitude ?? 0).toFixed(4)}, Lng ${(store.longitude ?? 0).toFixed(4)} (${escapeHtml(store.city)}/${escapeHtml(store.stateCode)})
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>${isPt ? "Nome da Área" : "Area Name"}</th>
            <th>${isPt ? "Raio (m)" : "Radius (m)"}</th>
            <th>${isPt ? "Taxa Base" : "Base Fee"}</th>
            <th>${isPt ? "Adicional/km" : "Per km Fee"}</th>
            <th>${isPt ? "Frete Grátis Acima de" : "Free Delivery Threshold"}</th>
            <th>${isPt ? "Ativa" : "Active"}</th>
          </tr>
        </thead>
        <tbody>
          ${storeDetail.serviceAreas
            .map(
              (area) => `
            <tr>
              <td>${escapeHtml(area.name)}</td>
              <td>${area.radiusMeters} m</td>
              <td>${escapeHtml(formatBrlCents(area.baseFeeCents, locale))}</td>
              <td>${escapeHtml(formatBrlCents(area.perKmFeeCents, locale))}</td>
              <td>${
                area.freeDeliveryMinOrderCents !== null
                  ? escapeHtml(formatBrlCents(area.freeDeliveryMinOrderCents, locale))
                  : "—"
              }</td>
              <td>${area.isActive ? "✓" : "✗"}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  const bodyHtml = `
    <section aria-label="${isPt ? "Configuração da Unidade" : "Store Configuration"}">
      ${settingsCardHtml}
      ${hoursCardHtml}
      ${coverageCardHtml}
    </section>
  `;

  return renderPartnerLayoutHtml({
    title:
      subRoute === "/store/hours"
        ? isPt
          ? "Horários da Loja"
          : "Store Hours"
        : subRoute === "/store/coverage"
          ? isPt
            ? "Área de Cobertura"
            : "Store Coverage"
          : isPt
            ? "Configurações da Loja"
            : "Store Settings",
    locale,
    activeRoute: subRoute,
    actorSummary: `${actor.fullName} (${actor.email})`,
    storeName: store.name,
    bodyHtml,
  });
}
