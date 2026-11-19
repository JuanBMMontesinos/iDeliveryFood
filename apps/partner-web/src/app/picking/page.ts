import type { IDeliveryApiClient } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  formatOperationalTimestamp,
  translateMessage,
  type AuthenticatedActorProfileContract,
  type OrderItemSubstitutionContract,
  type OrderPickTaskContract,
  type OrderPickingItemContract,
  type StoreDetailResponseContract,
  type StoreGroceryPickingOverviewContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  escapeHtml,
  formatBrlCents,
  renderPartnerLayoutHtml,
} from "../layout.js";

export interface PartnerPickingConsoleScreenModel {
  locale: SupportedLocale;
  actor: AuthenticatedActorProfileContract;
  storeDetail: StoreDetailResponseContract;
  pickingOverview: StoreGroceryPickingOverviewContract;
}

/**
 * Loads the M22 Grocery & Market Picking Console screen directly from live backend APIs
 * without mocked or hardcoded picking rows.
 */
export async function loadPartnerPickingConsoleScreen(params: {
  apiClient: IDeliveryApiClient;
  storeId: string;
  locale?: SupportedLocale;
}): Promise<PartnerPickingConsoleScreenModel> {
  const [meRes, storeRes, pickingRes] = await Promise.all([
    params.apiClient.getMe(),
    params.apiClient.getStoreDetail(params.storeId),
    params.apiClient.getStoreGroceryPickingOverview(params.storeId),
  ]);

  const locale = params.locale ?? meRes.data.preferredLocale ?? DEFAULT_LOCALE;
  return {
    locale,
    actor: meRes.data,
    storeDetail: storeRes.data,
    pickingOverview: pickingRes.data,
  };
}

function renderPickTaskRowsHtml(
  tasks: readonly OrderPickTaskContract[],
  locale: SupportedLocale
): string {
  if (tasks.length === 0) {
    return `<tr><td colspan="7">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`;
  }
  return tasks
    .map((t) => {
      const badgeClass =
        t.status === "PICKING_COMPLETED"
          ? "badge--open"
          : t.status === "AWAITING_CUSTOMER_SUBSTITUTION_APPROVAL"
            ? "badge--warn"
            : "badge";
      return `<tr data-testid="pick-task-row-${escapeHtml(t.id)}">
        <td><strong>#${t.orderNumber ?? escapeHtml(t.orderId.slice(0, 8))}</strong><br><small><code>${escapeHtml(t.id.slice(0, 8))}</code></small></td>
        <td><span class="badge ${badgeClass}">${escapeHtml(t.status)}</span></td>
        <td>${escapeHtml(formatBrlCents(t.preAuthorizedTotalCents, locale))}</td>
        <td>${escapeHtml(formatBrlCents(t.finalPickedTotalCents, locale))}</td>
        <td>${escapeHtml(formatBrlCents(Math.abs(t.weightAdjustmentDeltaCents), locale))} ${t.weightAdjustmentDeltaCents < 0 ? "(-)" : ""}</td>
        <td><strong>${escapeHtml(formatBrlCents(t.refundAdjustmentCents, locale))}</strong></td>
        <td>${escapeHtml(t.notes ?? "—")}</td>
      </tr>`;
    })
    .join("\n");
}

function renderPickingItemRowsHtml(
  items: readonly OrderPickingItemContract[],
  locale: SupportedLocale
): string {
  if (items.length === 0) {
    return `<tr><td colspan="7">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`;
  }
  const isPt = locale === "pt-BR";
  return items
    .map((item) => {
      const name = isPt ? item.productNamePtBr : item.productNameEn;
      const weightText =
        item.pricingUnit === "UNIT"
          ? `${item.quantity}x UNIT`
          : `${item.actualWeightGrams ?? item.estimatedWeightGrams ?? "—"}g / est. ${item.estimatedWeightGrams ?? "—"}g (${escapeHtml(item.pricingUnit)})`;
      const perKgText =
        item.pricePerKgCents !== null
          ? `${formatBrlCents(item.pricePerKgCents, locale)}/kg`
          : formatBrlCents(item.unitPriceCents, locale);
      const effectiveLine = item.adjustedLineCents ?? item.totalLineCents;
      return `<tr data-testid="picking-item-row-${escapeHtml(item.orderItemId)}">
        <td><strong>${escapeHtml(name)}</strong></td>
        <td><code>${escapeHtml(item.pricingUnit)}</code></td>
        <td>${escapeHtml(weightText)}</td>
        <td>${escapeHtml(perKgText)}</td>
        <td>${escapeHtml(formatBrlCents(item.totalLineCents, locale))}</td>
        <td><strong>${escapeHtml(formatBrlCents(effectiveLine, locale))}</strong></td>
        <td><code>${escapeHtml(item.substitutionPreference)}</code></td>
      </tr>`;
    })
    .join("\n");
}

function renderSubstitutionRowsHtml(
  substitutions: readonly OrderItemSubstitutionContract[],
  locale: SupportedLocale
): string {
  if (substitutions.length === 0) {
    return `<tr><td colspan="7">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`;
  }
  const isPt = locale === "pt-BR";
  return substitutions
    .map((sub) => {
      const suggestedName = isPt
        ? (sub.suggestedProductNamePtBr ?? "—")
        : (sub.suggestedProductNameEn ?? "—");
      const badgeClass =
        sub.status === "APPROVED_BY_CUSTOMER"
          ? "badge--open"
          : sub.status === "PENDING_CUSTOMER_APPROVAL"
            ? "badge--warn"
            : "badge--closed";
      return `<tr data-testid="picking-substitution-row-${escapeHtml(sub.id)}">
        <td><code>${escapeHtml(sub.orderItemId.slice(0, 8))}</code></td>
        <td><code>${escapeHtml(sub.customerPreference)}</code></td>
        <td><strong>${escapeHtml(suggestedName)}</strong></td>
        <td>${escapeHtml(formatBrlCents(sub.originalLineCents, locale))} → ${escapeHtml(formatBrlCents(sub.suggestedLineCents, locale))}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(sub.status)}</span></td>
        <td>${escapeHtml(sub.reason)}</td>
        <td>${escapeHtml(formatOperationalTimestamp(sub.expiresAtIso, locale))}</td>
      </tr>`;
    })
    .join("\n");
}

export function renderPartnerPickingConsoleHtml(
  model: PartnerPickingConsoleScreenModel
): string {
  const { locale, actor, storeDetail, pickingOverview } = model;
  const isPt = locale === "pt-BR";
  const store = storeDetail.store;
  const isEnabled = pickingOverview.status === "ACTIVE";

  const policyBannerHtml = !isEnabled
    ? `<div role="status" class="state-banner state-banner--error" data-testid="picking-policy-disabled-banner" style="margin-bottom:1rem;">
        <strong>${escapeHtml(translateMessage("picking.policy.disabled_notice", locale))}</strong>
        <span> (${escapeHtml(pickingOverview.reasonCode)})</span>
      </div>`
    : `<div role="status" class="state-banner" data-testid="picking-policy-active-banner" style="margin-bottom:1rem;">
        <strong>M22 ACTIVE (${escapeHtml(pickingOverview.policyKey)})</strong> — ${escapeHtml(
          translateMessage("picking.weighing.cap_notice", locale)
        )}
      </div>`;

  const bodyHtml = `
    <section aria-labelledby="picking-heading">
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:1rem;">
        <div>
          <h1 id="picking-heading" style="margin:0;">${escapeHtml(translateMessage("picking.console.title", locale))}</h1>
          <p style="margin:0.25rem 0;color:var(--muted);">
            ${escapeHtml(store.name)} · Policy: <code>${escapeHtml(pickingOverview.policyKey)}</code>
          </p>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <span class="badge ${isEnabled ? "badge--open" : "badge--warn"}" data-testid="picking-policy-status">
            ${escapeHtml(pickingOverview.status)}
          </span>
        </div>
      </div>

      ${policyBannerHtml}

      <div class="card" style="margin-bottom:1rem;">
        <h2 style="margin-top:0;">${isPt ? "1. Tarefas de Separação (Order Pick Tasks)" : "1. Order Pick Tasks"}</h2>
        <div style="overflow-x:auto;">
          <table data-testid="picking-tasks-table">
            <thead>
              <tr>
                <th scope="col">${isPt ? "Pedido / Tarefa" : "Order / Task"}</th>
                <th scope="col">Status</th>
                <th scope="col">${isPt ? "Teto Pré-Autorizado" : "Pre-Authorized Ceiling"}</th>
                <th scope="col">${isPt ? "Total Final Separado" : "Final Picked Total"}</th>
                <th scope="col">${isPt ? "Delta Pesagem/Subst." : "Weight/Sub Delta"}</th>
                <th scope="col">${isPt ? "Reembolso Automático (M12/M13)" : "Auto Refund (M12/M13)"}</th>
                <th scope="col">${isPt ? "Notas" : "Notes"}</th>
              </tr>
            </thead>
            <tbody>${renderPickTaskRowsHtml(pickingOverview.pickTasks, locale)}</tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin-bottom:1rem;">
        <h2 style="margin-top:0;">${isPt ? "2. Itens Pesáveis (HALF_UP Centavos) e Preferência de Substituição" : "2. Weighed Items (HALF_UP Cents) & Substitution Preferences"}</h2>
        <div style="overflow-x:auto;">
          <table data-testid="picking-items-table">
            <thead>
              <tr>
                <th scope="col">${isPt ? "Produto" : "Product"}</th>
                <th scope="col">${isPt ? "Unidade" : "Unit"}</th>
                <th scope="col">${isPt ? "Peso Aferido / Est." : "Actual / Est. Weight"}</th>
                <th scope="col">${isPt ? "Preço Base" : "Base Price"}</th>
                <th scope="col">${isPt ? "Linha Pré-Autorizada" : "Pre-Authorized Line"}</th>
                <th scope="col">${isPt ? "Linha Ajustada" : "Adjusted Line"}</th>
                <th scope="col">${isPt ? "Preferência do Cliente" : "Customer Preference"}</th>
              </tr>
            </thead>
            <tbody>${renderPickingItemRowsHtml(pickingOverview.orderItems, locale)}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-top:0;">${isPt ? "3. Substituições com Consentimento Explícito do Cliente" : "3. Customer-Consented Item Substitutions"}</h2>
        <div style="overflow-x:auto;">
          <table data-testid="picking-substitutions-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">${isPt ? "Regra Configurada" : "Preference Rule"}</th>
                <th scope="col">${isPt ? "Sugestão" : "Suggested Item"}</th>
                <th scope="col">${isPt ? "Preço Original → Sugerido" : "Original → Suggested"}</th>
                <th scope="col">Status</th>
                <th scope="col">${isPt ? "Motivo" : "Reason"}</th>
                <th scope="col">${isPt ? "Timeout (America/Sao_Paulo)" : "Timeout (America/Sao_Paulo)"}</th>
              </tr>
            </thead>
            <tbody>${renderSubstitutionRowsHtml(pickingOverview.substitutions, locale)}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  return renderPartnerLayoutHtml({
    title: translateMessage("picking.console.title", locale),
    locale,
    activeRoute: "/picking",
    actorSummary: `${actor.fullName} (${actor.email})`,
    storeName: store.name,
    bodyHtml,
  });
}
