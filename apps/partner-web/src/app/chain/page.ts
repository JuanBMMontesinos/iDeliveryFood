import type { IDeliveryApiClient } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  type AuthenticatedActorProfileContract,
  type MultiUnitStoreSummaryContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  escapeHtml,
  formatBrlCents,
  renderPartnerLayoutHtml,
} from "../layout.js";

export interface PartnerChainPortalScreenModel {
  locale: SupportedLocale;
  organizationId: string;
  actor: AuthenticatedActorProfileContract;
  units: readonly MultiUnitStoreSummaryContract[];
}

export async function loadPartnerChainPortalScreen(params: {
  apiClient: IDeliveryApiClient;
  organizationId: string;
  locale?: SupportedLocale;
}): Promise<PartnerChainPortalScreenModel> {
  const [meRes, summaryRes] = await Promise.all([
    params.apiClient.getMe(),
    params.apiClient.getOrganizationUnitsSummary(params.organizationId),
  ]);

  const locale = params.locale ?? meRes.data.preferredLocale ?? DEFAULT_LOCALE;
  return {
    locale,
    organizationId: params.organizationId,
    actor: meRes.data,
    units: summaryRes.data,
  };
}

export function renderPartnerChainPortalHtml(
  model: PartnerChainPortalScreenModel
): string {
  const { locale, actor, units, organizationId } = model;
  const isPt = locale === "pt-BR";

  const totalUnits = units.length;
  const openUnitsCount = units.filter((u) => u.isPublished && !u.isPaused).length;
  const totalActiveOrders = units.reduce((acc, u) => acc + u.activeOrderCount, 0);
  const totalGrossSalesCents = units.reduce(
    (acc, u) => acc + u.grossMerchandiseCents,
    0
  );

  const unitRowsHtml = units
    .map(
      (unit) => `
      <tr data-testid="chain-unit-row-${escapeHtml(unit.storeId)}">
        <td><strong>${escapeHtml(unit.storeName)}</strong> (<code>${escapeHtml(unit.storeId)}</code>)</td>
        <td>
          <span class="badge ${unit.isPublished && !unit.isPaused ? "badge--open" : "badge--closed"}">
            ${unit.isPublished ? "PUBLISHED" : "DRAFT"} ${unit.isPaused ? "(PAUSED)" : ""}
          </span>
        </td>
        <td>${unit.activeOrderCount}</td>
        <td>${escapeHtml(formatBrlCents(unit.grossMerchandiseCents, locale))}</td>
      </tr>
    `
    )
    .join("");

  const bodyHtml = `
    <section aria-labelledby="chain-heading">
      <div class="card">
        <h1 id="chain-heading" style="margin-top:0;">
          ${isPt ? "Portal Multi-Unidade / Franquia (M09)" : "Multi-Unit Chain & Franchise Portal (M09)"}
        </h1>
        <p>
          <strong>Org: <code>${escapeHtml(organizationId)}</code></strong> ·
          ${isPt ? "Total de Unidades:" : "Total Units:"} <strong>${totalUnits}</strong> ·
          ${isPt ? "Unidades Abertas:" : "Open Units:"} <strong>${openUnitsCount}</strong> ·
          ${isPt ? "Pedidos Ativos na Rede:" : "Chain Active Orders:"} <strong>${totalActiveOrders}</strong> ·
          ${isPt ? "GMV Consolidado:" : "Consolidated GMV:"} <strong>${escapeHtml(formatBrlCents(totalGrossSalesCents, locale))}</strong>
        </p>
      </div>

      <div class="card">
        <h2 style="margin-top:0;">${isPt ? "Desempenho Comparativo por Unidade" : "Unit-by-Unit Comparative Performance"}</h2>
        <table class="data-table" data-testid="chain-units-table">
          <thead>
            <tr>
              <th>${isPt ? "Unidade (Loja)" : "Store Unit"}</th>
              <th>${isPt ? "Status Operacional" : "Operational Status"}</th>
              <th>${isPt ? "Pedidos Ativos" : "Active Orders"}</th>
              <th>${isPt ? "GMV Capturado" : "Captured GMV"}</th>
            </tr>
          </thead>
          <tbody>
            ${unitRowsHtml}
          </tbody>
        </table>
      </div>

      <div class="card" data-testid="chain-batch-catalog-card">
        <h2 style="margin-top:0;">${isPt ? "Propagação de Cardápio & Preços em Lote (Dry-Run / Apply)" : "Batch Catalog & Price Propagation (Dry-Run / Apply)"}</h2>
        <p>
          ${
            isPt
              ? "Endpoint M09: POST /v1/organizations/:orgId/catalog/batch valida permissões unidade por unidade e reporta status parcial (APPLIED, DENIED_SCOPE, NOT_FOUND)."
              : "M09 Endpoint: POST /v1/organizations/:orgId/catalog/batch validates unit-by-unit permissions and reports partial status (APPLIED, DENIED_SCOPE, NOT_FOUND)."
          }
        </p>
      </div>
    </section>
  `;

  return renderPartnerLayoutHtml({
    title: isPt ? "Rede Multi-Unidade (M09)" : "Multi-Unit Chain (M09)",
    locale,
    activeRoute: "/chain",
    actorSummary: `${actor.fullName} (${actor.email})`,
    bodyHtml,
  });
}
