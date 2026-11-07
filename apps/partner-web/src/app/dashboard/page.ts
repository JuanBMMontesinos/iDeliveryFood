import type { IDeliveryApiClient } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  type AuthenticatedActorProfileContract,
  type StoreDetailResponseContract,
  type StoreOrdersQueueResponseContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  escapeHtml,
  formatBrlCents,
  renderPartnerLayoutHtml,
} from "../layout.js";

export interface PartnerDashboardScreenModel {
  locale: SupportedLocale;
  actor: AuthenticatedActorProfileContract;
  storeDetail: StoreDetailResponseContract;
  queue: StoreOrdersQueueResponseContract;
  kpis: {
    activeOrdersCount: number;
    totalOrdersInQueue: number;
    grossMerchandiseValueCents: number;
    averageTicketCents: number;
    cancellationRatePercent: number;
    prepTimeMinutes: number;
    overdueOrdersCount: number;
  };
}

export async function loadPartnerDashboardScreen(params: {
  apiClient: IDeliveryApiClient;
  organizationId: string;
  storeId: string;
  locale?: SupportedLocale;
}): Promise<PartnerDashboardScreenModel> {
  const [meRes, storeRes, queueRes] = await Promise.all([
    params.apiClient.getMe(),
    params.apiClient.getStoreDetail(params.storeId),
    params.apiClient.getStoreOrdersQueue(params.storeId, params.organizationId),
  ]);

  const locale = params.locale ?? meRes.data.preferredLocale ?? DEFAULT_LOCALE;
  const queue = queueRes.data;
  const allCards = [
    ...queue.columns.NEW,
    ...queue.columns.ACCEPTED,
    ...queue.columns.PREPARING,
    ...queue.columns.READY,
    ...queue.columns.IN_TRANSIT,
    ...queue.columns.COMPLETED,
    ...queue.columns.CANCELLED,
  ];

  const nonCancelled = allCards.filter((c) => c.column !== "CANCELLED");
  const gmvCents = nonCancelled.reduce((acc, c) => acc + c.totalCents, 0);
  const avgTicketCents =
    nonCancelled.length > 0 ? Math.round(gmvCents / nonCancelled.length) : 0;
  const cancellationRatePercent =
    allCards.length > 0
      ? Math.round((queue.columns.CANCELLED.length / allCards.length) * 100)
      : 0;
  const overdueOrdersCount = allCards.filter((c) => c.isSlaBreached).length;

  return {
    locale,
    actor: meRes.data,
    storeDetail: storeRes.data,
    queue,
    kpis: {
      activeOrdersCount: queue.activeOrderCount,
      totalOrdersInQueue: allCards.length,
      grossMerchandiseValueCents: gmvCents,
      averageTicketCents: avgTicketCents,
      cancellationRatePercent,
      prepTimeMinutes: storeRes.data.store.prepTimeMinMinutes,
      overdueOrdersCount,
    },
  };
}

export function renderPartnerDashboardHtml(model: PartnerDashboardScreenModel): string {
  const { locale, storeDetail, kpis, actor } = model;
  const isPt = locale === "pt-BR";
  const store = storeDetail.store;

  const bodyHtml = `
    <section aria-labelledby="dashboard-heading">
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
        <div>
          <h1 id="dashboard-heading" style="margin:0;">${escapeHtml(store.name)}</h1>
          <p style="margin:0.25rem 0;color:var(--muted);">
            Slug: <code>${escapeHtml(store.slug)}</code> · ${escapeHtml(store.city)}/${escapeHtml(store.stateCode)}
          </p>
        </div>
        <div>
          <span class="badge ${storeDetail.availability.isOpen ? "badge--open" : "badge--closed"}" data-testid="store-availability-badge">
            ${escapeHtml(storeDetail.availability.reasonCode)}
          </span>
          <a href="/kitchen?locale=${escapeHtml(locale)}" class="btn" style="margin-left:0.5rem;">
            ${isPt ? "Abrir Console KDS" : "Open KDS Console"}
          </a>
        </div>
      </div>

      <div class="grid" role="region" aria-label="${isPt ? "Indicadores Operacionais" : "Operational KPIs"}">
        <article class="card" data-testid="kpi-active-orders">
          <h2 style="margin-top:0;font-size:0.95rem;color:var(--muted);">${isPt ? "Pedidos Ativos" : "Active Orders"}</h2>
          <p style="font-size:1.75rem;font-weight:800;margin:0.25rem 0;">${kpis.activeOrdersCount}</p>
          <small>${isPt ? "Em atraso SLA:" : "Overdue SLA:"} ${kpis.overdueOrdersCount}</small>
        </article>

        <article class="card" data-testid="kpi-gmv">
          <h2 style="margin-top:0;font-size:0.95rem;color:var(--muted);">${isPt ? "GMV na Fila" : "Queue GMV"}</h2>
          <p style="font-size:1.75rem;font-weight:800;margin:0.25rem 0;">${escapeHtml(formatBrlCents(kpis.grossMerchandiseValueCents, locale))}</p>
          <small>${isPt ? "Total de pedidos:" : "Total orders:"} ${kpis.totalOrdersInQueue}</small>
        </article>

        <article class="card" data-testid="kpi-avg-ticket">
          <h2 style="margin-top:0;font-size:0.95rem;color:var(--muted);">${isPt ? "Ticket Médio" : "Average Ticket"}</h2>
          <p style="font-size:1.75rem;font-weight:800;margin:0.25rem 0;">${escapeHtml(formatBrlCents(kpis.averageTicketCents, locale))}</p>
          <small>${isPt ? "Pedido mínimo:" : "Minimum order:"} ${escapeHtml(formatBrlCents(store.minOrderCents, locale))}</small>
        </article>

        <article class="card" data-testid="kpi-sla-cancel">
          <h2 style="margin-top:0;font-size:0.95rem;color:var(--muted);">${isPt ? "Tempo de Preparo & Cancelamento" : "Prep SLA & Cancellation"}</h2>
          <p style="font-size:1.75rem;font-weight:800;margin:0.25rem 0;">${store.prepTimeMinMinutes}-${store.prepTimeMaxMinutes} min</p>
          <small>${isPt ? "Taxa de cancelamento:" : "Cancellation rate:"} ${kpis.cancellationRatePercent}%</small>
        </article>
      </div>
    </section>
  `;

  return renderPartnerLayoutHtml({
    title: isPt ? "Painel Operacional da Loja" : "Store Operational Dashboard",
    locale,
    activeRoute: "/dashboard",
    actorSummary: `${actor.fullName} (${actor.email})`,
    storeName: store.name,
    bodyHtml,
  });
}
