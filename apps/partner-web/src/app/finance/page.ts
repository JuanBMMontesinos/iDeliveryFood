import type { IDeliveryApiClient } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  type AuthenticatedActorProfileContract,
  type PartnerFinanceSummaryContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { buildPartnerPortalScreenModel } from "../../index.js";
import {
  escapeHtml,
  formatBrlCents,
  renderPartnerLayoutHtml,
} from "../layout.js";

export interface PartnerFinanceScreenModel {
  locale: SupportedLocale;
  organizationId: string;
  actor: AuthenticatedActorProfileContract;
  canAccessFinancialLedger: boolean;
  financeSegregationNotice: string | null;
  financeSummary: PartnerFinanceSummaryContract | null;
}

export async function loadPartnerFinanceScreen(params: {
  apiClient: IDeliveryApiClient;
  organizationId: string;
  storeId?: string | null;
  locale?: SupportedLocale;
}): Promise<PartnerFinanceScreenModel> {
  const meRes = await params.apiClient.getMe();
  const actor = meRes.data;
  const locale = params.locale ?? actor.preferredLocale ?? DEFAULT_LOCALE;

  const portalAccess = buildPartnerPortalScreenModel({
    actor,
    organizationId: params.organizationId,
    storeId: params.storeId ?? null,
    locale,
  });

  if (!portalAccess.canAccessFinancialLedger) {
    return {
      locale,
      organizationId: params.organizationId,
      actor,
      canAccessFinancialLedger: false,
      financeSegregationNotice: portalAccess.financeSegregationNotice,
      financeSummary: null,
    };
  }

  const financeRes = await params.apiClient.getPartnerFinanceSummary(
    params.organizationId
  );

  return {
    locale,
    organizationId: params.organizationId,
    actor,
    canAccessFinancialLedger: true,
    financeSegregationNotice: null,
    financeSummary: financeRes.data,
  };
}

export function renderPartnerFinanceHtml(model: PartnerFinanceScreenModel): string {
  const {
    locale,
    actor,
    canAccessFinancialLedger,
    financeSegregationNotice,
    financeSummary,
  } = model;
  const isPt = locale === "pt-BR";

  if (!canAccessFinancialLedger || !financeSummary) {
    const bodyHtml = `
      <section aria-labelledby="finance-segregated-heading">
        <div class="card" data-testid="finance-segregation-card">
          <h1 id="finance-segregated-heading" style="margin-top:0;color:var(--danger);">
            ${isPt ? "Acesso Segregado — Razão Financeiro Restrito (M03/M13)" : "Segregated Access — Financial Ledger Restricted (M03/M13)"}
          </h1>
          <p>${escapeHtml(financeSegregationNotice ?? "")}</p>
        </div>
      </section>
    `;

    return renderPartnerLayoutHtml({
      title: isPt ? "Financeiro Restrito" : "Restricted Finance",
      locale,
      activeRoute: "/finance",
      actorSummary: `${actor.fullName} (${actor.email})`,
      bodyHtml,
    });
  }

  const settlementsRows = financeSummary.settlements
    .map(
      (s) => `
      <tr data-testid="settlement-row-${escapeHtml(s.id)}">
        <td><code>${escapeHtml(s.periodStart)} → ${escapeHtml(s.periodEnd)}</code></td>
        <td><strong>${escapeHtml(formatBrlCents(s.amountCents, locale))}</strong></td>
        <td><span class="badge">${escapeHtml(s.status)}</span></td>
      </tr>
    `
    )
    .join("");

  const bodyHtml = `
    <section aria-labelledby="finance-heading">
      <div class="card">
        <h1 id="finance-heading" style="margin-top:0;">
          ${isPt ? "Extrato Financeiro, Repasses & Conta Bancária (M07/M13)" : "Financial Statement, Settlements & Bank Account (M07/M13)"}
        </h1>
        <div class="grid">
          <article class="card" data-testid="finance-payable-balance">
            <h2 style="margin-top:0;font-size:0.9rem;color:var(--muted);">
              ${isPt ? "Saldo Líquido no Razão (MERCHANT_PAYABLE)" : "Ledger Payable Balance (MERCHANT_PAYABLE)"}
            </h2>
            <p style="font-size:1.75rem;font-weight:800;margin:0.25rem 0;">
              ${escapeHtml(formatBrlCents(financeSummary.payableBalanceCents, locale))}
            </p>
          </article>

          <article class="card" data-testid="finance-gmv-breakdown">
            <h2 style="margin-top:0;font-size:0.9rem;color:var(--muted);">
              ${isPt ? "GMV Capturado vs. Comissão da Plataforma" : "Captured GMV vs. Platform Commission"}
            </h2>
            <p style="margin:0.25rem 0;">
              <strong>GMV:</strong> ${escapeHtml(formatBrlCents(financeSummary.grossMerchandiseCents, locale))}
            </p>
            <p style="margin:0.25rem 0;">
              <strong>${isPt ? "Comissão:" : "Commission:"}</strong> ${escapeHtml(formatBrlCents(financeSummary.platformCommissionCents, locale))}
            </p>
            <p style="margin:0.25rem 0;">
              <strong>${isPt ? "Líquido Loja:" : "Merchant Net:"}</strong> ${escapeHtml(formatBrlCents(financeSummary.merchantNetCents, locale))}
            </p>
          </article>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-top:0;">${isPt ? "Cronograma de Repasses (Settlements)" : "Settlements Schedule"}</h2>
        <table class="data-table" data-testid="settlements-table">
          <thead>
            <tr>
              <th>${isPt ? "Período" : "Period"}</th>
              <th>${isPt ? "Repasse Líquido" : "Net Payout"}</th>
              <th>${isPt ? "Status" : "Status"}</th>
            </tr>
          </thead>
          <tbody>
            ${settlementsRows}
          </tbody>
        </table>
      </div>

      <div class="card" data-testid="bank-change-policy-card">
        <h2 style="margin-top:0;">${isPt ? "Alteração de Conta Bancária de Repasse" : "Settlement Bank Account Change Request"}</h2>
        <p>
          ${
            isPt
              ? "Exige papel partner_owner com MFA aal2 ativo. Toda solicitação entra em fila PENDING de dupla aprovação financeira e nunca dispara liquidação imediata."
              : "Requires partner_owner role with active MFA aal2. Every request enters a PENDING dual-approval queue and never triggers immediate payout."
          }
        </p>
      </div>
    </section>
  `;

  return renderPartnerLayoutHtml({
    title: isPt ? "Financeiro & Repasses" : "Finance & Settlements",
    locale,
    activeRoute: "/finance",
    actorSummary: `${actor.fullName} (${actor.email})`,
    bodyHtml,
  });
}
