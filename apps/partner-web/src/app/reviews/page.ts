import type { IDeliveryApiClient } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  type AuthenticatedActorProfileContract,
  type MerchantContractRecordContract,
  type OrderReviewContract,
  type SupportCaseContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { escapeHtml, renderPartnerLayoutHtml } from "../layout.js";

export type PartnerEngagementSubRoute = "/reviews" | "/contract" | "/support";

export interface PartnerEngagementScreenModel {
  locale: SupportedLocale;
  subRoute: PartnerEngagementSubRoute;
  actor: AuthenticatedActorProfileContract;
  reviews: readonly OrderReviewContract[];
  contract: MerchantContractRecordContract | null;
  supportCases: readonly SupportCaseContract[];
}

export async function loadPartnerEngagementScreen(params: {
  apiClient: IDeliveryApiClient;
  organizationId: string;
  storeId: string;
  subRoute?: PartnerEngagementSubRoute;
  locale?: SupportedLocale;
}): Promise<PartnerEngagementScreenModel> {
  const [meRes, reviewsRes, contractRes, supportRes] = await Promise.all([
    params.apiClient.getMe(),
    params.apiClient.listStoreReviews(params.storeId),
    params.apiClient.getMerchantContract(params.organizationId),
    params.apiClient.listStoreSupportCases(params.storeId),
  ]);

  const locale = params.locale ?? meRes.data.preferredLocale ?? DEFAULT_LOCALE;
  return {
    locale,
    subRoute: params.subRoute ?? "/reviews",
    actor: meRes.data,
    reviews: reviewsRes.data,
    contract: contractRes.data,
    supportCases: supportRes.data,
  };
}

export function renderPartnerEngagementHtml(
  model: PartnerEngagementScreenModel
): string {
  const { locale, subRoute, actor, reviews, contract, supportCases } = model;
  const isPt = locale === "pt-BR";

  const reviewsHtml = `
    <div class="card" data-testid="partner-reviews-section">
      <h1 style="margin-top:0;">${isPt ? "Avaliações Verificadas & Respostas do Parceiro" : "Verified Customer Reviews & Partner Replies"}</h1>
      ${reviews
        .map(
          (rev) => `
          <article class="card" data-testid="review-card-${escapeHtml(rev.id)}">
            <p style="margin:0;">
              <strong>★ ${rev.rating}/5</strong> · Pedido <code>${escapeHtml(rev.orderId)}</code>
            </p>
            <p style="margin:0.4rem 0;">${escapeHtml(rev.comment ?? "")}</p>
            ${
              rev.partnerReply
                ? `<p style="margin:0.4rem 0;color:var(--success);" data-testid="partner-reply-${escapeHtml(rev.id)}">
                    <strong>${isPt ? "Resposta da Loja:" : "Partner Reply:"}</strong> ${escapeHtml(rev.partnerReply)}
                  </p>`
                : `<p style="margin:0.4rem 0;color:var(--muted);">${isPt ? "Sem resposta ainda" : "No reply yet"}</p>`
            }
          </article>
        `
        )
        .join("")}
    </div>
  `;

  const contractHtml = contract
    ? `
    <div class="card" data-testid="partner-contract-section">
      <h2 style="margin-top:0;">${isPt ? "Contrato Comercial Vigente (M13 / M18)" : "Active Commercial Contract (M13 / M18)"}</h2>
      <p><strong>${isPt ? "Versão do Plano:" : "Contract Version:"}</strong> <code>v${contract.versionNumber}</code> (<span class="badge">${escapeHtml(contract.legalTemplateStatus)}</span>)</p>
      <p><strong>${isPt ? "Comissão Entrega Plataforma (bps):" : "Platform Delivery Commission (bps):"}</strong> ${contract.platformDeliveryCommissionBps} bps (${(contract.platformDeliveryCommissionBps / 100).toFixed(2)}%)</p>
      <p><strong>${isPt ? "Comissão Entrega Própria (bps):" : "Merchant Delivery Commission (bps):"}</strong> ${contract.merchantDeliveryCommissionBps} bps (${(contract.merchantDeliveryCommissionBps / 100).toFixed(2)}%)</p>
      <p><strong>${isPt ? "Comissão Retirada (bps):" : "Pickup Commission (bps):"}</strong> ${contract.pickupCommissionBps} bps (${(contract.pickupCommissionBps / 100).toFixed(2)}%)</p>
      <p><strong>${isPt ? "Taxa de Serviço (bps):" : "Service Fee (bps):"}</strong> ${contract.serviceFeeBps ?? 500} bps (${((contract.serviceFeeBps ?? 500) / 100).toFixed(2)}%)</p>
      <p><strong>${isPt ? "Ciclo de Liquidação:" : "Payout Cycle:"}</strong> D+${contract.payoutCycleDays}</p>
      <p data-testid="partner-contract-acceptance-status">
        <strong>${isPt ? "Status de Aceite (partner_owner):" : "Partner Owner Acceptance Status:"}</strong>
        ${
          contract.acceptedByPartnerOwnerId
            ? `<span class="badge">${isPt ? "Aceito formalmente por" : "Formally accepted by"} <code>${escapeHtml(contract.acceptedByPartnerOwnerId)}</code> (${escapeHtml(contract.acceptedAtIso ?? "")})</span>`
            : `<span class="badge">${isPt ? "Aguardando aceite formal do partner_owner" : "Pending formal acceptance by partner_owner"}</span>`
        }
      </p>
    </div>
  `
    : "";

  const supportHtml = `
    <div class="card" data-testid="partner-support-section">
      <h2 style="margin-top:0;">${isPt ? "Chamados de Suporte & Disputas da Loja (M18)" : "Store Support Cases & Disputes (M18)"}</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>#${isPt ? "Chamado" : "Case"}</th>
            <th>${isPt ? "Assunto" : "Subject"}</th>
            <th>${isPt ? "Categoria" : "Category"}</th>
            <th>${isPt ? "Prioridade" : "Priority"}</th>
            <th>${isPt ? "Status" : "Status"}</th>
          </tr>
        </thead>
        <tbody>
          ${supportCases
            .map(
              (sc) => `
            <tr data-testid="support-case-row-${escapeHtml(sc.id)}">
              <td><code>#${sc.caseNumber}</code></td>
              <td>${escapeHtml(sc.subject)}</td>
              <td>${escapeHtml(sc.category)}</td>
              <td><span class="badge">${escapeHtml(sc.priority)}</span></td>
              <td><span class="badge">${escapeHtml(sc.status)}</span></td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  return renderPartnerLayoutHtml({
    title:
      subRoute === "/contract"
        ? isPt
          ? "Contrato Comercial"
          : "Commercial Contract"
        : subRoute === "/support"
          ? isPt
            ? "Suporte ao Parceiro"
            : "Partner Support"
          : isPt
            ? "Avaliações da Loja"
            : "Store Reviews",
    locale,
    activeRoute: subRoute,
    actorSummary: `${actor.fullName} (${actor.email})`,
    bodyHtml: `<section>${reviewsHtml}${contractHtml}${supportHtml}</section>`,
  });
}
