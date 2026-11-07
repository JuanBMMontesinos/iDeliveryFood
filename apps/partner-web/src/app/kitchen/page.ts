import type { IDeliveryApiClient } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  translateMessage,
  type AuthenticatedActorProfileContract,
  type KitchenOrderCardContract,
  type KitchenQueueColumnStatus,
  type StoreDetailResponseContract,
  type StoreOrdersQueueResponseContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  escapeHtml,
  formatBrlCents,
  renderPartnerLayoutHtml,
} from "../layout.js";

export interface PartnerKitchenConsoleScreenModel {
  locale: SupportedLocale;
  actor: AuthenticatedActorProfileContract;
  storeDetail: StoreDetailResponseContract;
  queue: StoreOrdersQueueResponseContract;
  audibleAlertsConsented: boolean;
}

export async function loadPartnerKitchenConsoleScreen(params: {
  apiClient: IDeliveryApiClient;
  organizationId: string;
  storeId: string;
  audibleAlertsConsented?: boolean;
  locale?: SupportedLocale;
}): Promise<PartnerKitchenConsoleScreenModel> {
  const [meRes, storeRes, queueRes] = await Promise.all([
    params.apiClient.getMe(),
    params.apiClient.getStoreDetail(params.storeId),
    params.apiClient.getStoreOrdersQueue(params.storeId, params.organizationId),
  ]);

  const locale = params.locale ?? meRes.data.preferredLocale ?? DEFAULT_LOCALE;
  return {
    locale,
    actor: meRes.data,
    storeDetail: storeRes.data,
    queue: queueRes.data,
    audibleAlertsConsented: params.audibleAlertsConsented ?? false,
  };
}

function renderKitchenCardHtml(
  card: KitchenOrderCardContract,
  locale: SupportedLocale
): string {
  const isPt = locale === "pt-BR";
  return `
    <article class="card thermal-ticket" data-testid="kds-order-card-${escapeHtml(card.orderId)}">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>#${card.orderNumber}</strong>
        <span class="badge ${card.isSlaBreached ? "badge--closed" : "badge--open"}">
          SLA: ${card.remainingSlaSeconds}s
        </span>
      </div>
      <p style="margin:0.35rem 0;font-size:0.85rem;">
        <strong>${isPt ? "Modalidade:" : "Modality:"}</strong> ${escapeHtml(card.fulfillmentModality)} ·
        <strong>v${card.version}</strong>
      </p>
      <p style="margin:0.35rem 0;font-size:0.9rem;">
        <strong>${isPt ? "Itens:" : "Items:"}</strong> ${card.itemsCount} ·
        <strong>${escapeHtml(formatBrlCents(card.totalCents, locale))}</strong>
      </p>
      ${
        card.customerNotes
          ? `<p style="margin:0.25rem 0;font-size:0.8rem;background:#FEF9C3;padding:0.25rem 0.4rem;border-radius:0.25rem;">
              <strong>Obs:</strong> ${escapeHtml(card.customerNotes)}
            </p>`
          : ""
      }
    </article>
  `;
}

export function renderPartnerKitchenConsoleHtml(
  model: PartnerKitchenConsoleScreenModel
): string {
  const { locale, actor, storeDetail, queue, audibleAlertsConsented } = model;
  const isPt = locale === "pt-BR";
  const store = storeDetail.store;

  const displayedColumns: Array<{ status: KitchenQueueColumnStatus; label: string }> = [
    {
      status: "NEW",
      label: isPt ? "1. Novos (Aceitar)" : "1. New (Accept)",
    },
    {
      status: "ACCEPTED",
      label: isPt ? "2. Aceitos" : "2. Accepted",
    },
    {
      status: "PREPARING",
      label: isPt ? "3. Em Preparo" : "3. Preparing",
    },
    {
      status: "READY",
      label: isPt ? "4. Prontos p/ Coleta" : "4. Ready for Pickup",
    },
    {
      status: "IN_TRANSIT",
      label: isPt ? "5. Em Rota" : "5. In Transit",
    },
    {
      status: "COMPLETED",
      label: isPt ? "6. Concluídos" : "6. Completed",
    },
  ];

  const columnsHtml = displayedColumns
    .map((col) => {
      const cards = queue.columns[col.status] ?? [];
      return `
        <section class="kanban-col" data-testid="kds-column-${escapeHtml(col.status)}" aria-label="${escapeHtml(col.label)}">
          <h2 style="margin-top:0;font-size:0.95rem;display:flex;justify-content:space-between;">
            <span>${escapeHtml(col.label)}</span>
            <span class="badge">${cards.length}</span>
          </h2>
          ${
            cards.length > 0
              ? cards.map((c) => renderKitchenCardHtml(c, locale)).join("")
              : `<p style="font-size:0.85rem;color:var(--muted);">${isPt ? "Fila vazia" : "Empty column"}</p>`
          }
        </section>
      `;
    })
    .join("");

  const pausedNoticeHtml = queue.isStorePaused
    ? `<div role="status" class="state-banner" data-testid="kds-store-paused-banner">
        <strong>${escapeHtml(
          translateMessage("partner.store.paused_banner", locale, {
            reason: "Manual pause",
          })
        )}</strong>
      </div>`
    : "";

  const bodyHtml = `
    <section aria-labelledby="kds-heading">
      <div class="card no-print" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
        <div>
          <h1 id="kds-heading" style="margin:0;">${escapeHtml(translateMessage("kitchen.queue.title", locale))}</h1>
          <p style="margin:0.25rem 0;color:var(--muted);">
            ${isPt ? "Pedidos ativos:" : "Active orders:"} <strong>${queue.activeOrderCount}</strong> ·
            Cursor Realtime: <code>${escapeHtml(queue.latestEventCursor ?? "initial")}</code>
          </p>
        </div>
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <span class="badge ${audibleAlertsConsented ? "badge--open" : "badge--warn"}" data-testid="kds-audio-consent">
            ${escapeHtml(translateMessage("kitchen.sound.consent_label", locale))}: ${audibleAlertsConsented ? "ON" : "OFF"}
          </span>
        </div>
      </div>
      ${pausedNoticeHtml}
      <div class="kanban-board" data-testid="kds-kanban-board">
        ${columnsHtml}
      </div>
    </section>
  `;

  return renderPartnerLayoutHtml({
    title: translateMessage("kitchen.queue.title", locale),
    locale,
    activeRoute: "/kitchen",
    actorSummary: `${actor.fullName} (${actor.email})`,
    storeName: store.name,
    bodyHtml,
  });
}
