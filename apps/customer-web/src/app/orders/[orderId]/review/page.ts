import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  translateMessage,
  type OrderReviewContract,
  type SupportCaseContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { buildUiScreenStateBanner, type UiScreenStateBanner } from "@ideliveryfood/ui-web";
import { escapeHtml, renderCustomerAppShellHtml } from "../../../layout.js";

export interface CustomerOrderReviewAndSupportScreenModel {
  title: string;
  supportTitle: string;
  locale: SupportedLocale;
  orderId: string;
  banner: UiScreenStateBanner | null;
  review: OrderReviewContract | null;
  supportCases: SupportCaseContract[];
}

export async function loadCustomerOrderReviewAndSupportScreen(params: {
  apiClient: IDeliveryApiClient;
  orderId: string;
  locale?: SupportedLocale;
  isOffline?: boolean;
}): Promise<CustomerOrderReviewAndSupportScreenModel> {
  const locale = params.locale ?? params.apiClient.getLocale() ?? DEFAULT_LOCALE;
  params.apiClient.setLocale(locale);
  const title = translateMessage("customer.review.title", locale);
  const supportTitle = translateMessage("customer.support.title", locale);

  if (params.isOffline) {
    return {
      title,
      supportTitle,
      locale,
      orderId: params.orderId,
      banner: buildUiScreenStateBanner({ kind: "offline", locale }),
      review: null,
      supportCases: [],
    };
  }

  try {
    const [reviewRes, casesRes] = await Promise.all([
      params.apiClient.getOrderReview(params.orderId),
      params.apiClient.listOrderSupportCases(params.orderId),
    ]);

    return {
      title,
      supportTitle,
      locale,
      orderId: params.orderId,
      banner: null,
      review: reviewRes.data,
      supportCases: casesRes.data,
    };
  } catch (err) {
    const errorCode = err instanceof IDeliveryApiError ? err.envelope.error.code : "NETWORK_ERROR";
    const correlationId = err instanceof IDeliveryApiError ? err.envelope.error.correlationId : "N/A";
    return {
      title,
      supportTitle,
      locale,
      orderId: params.orderId,
      banner: buildUiScreenStateBanner({ kind: "error", locale, errorCode, correlationId }),
      review: null,
      supportCases: [],
    };
  }
}

export function renderCustomerOrderReviewAndSupportHtml(
  model: CustomerOrderReviewAndSupportScreenModel
): string {
  const isPt = model.locale === "pt-BR";
  const reviewHtml = model.review
    ? `<div class="card">
        <p><strong>${isPt ? "Nota" : "Rating"}:</strong> ${model.review.rating}/5</p>
        <p>${escapeHtml(model.review.comment ?? "")}</p>
        ${
          model.review.partnerReply
            ? `<blockquote style="border-left:3px solid var(--brand-accent);padding-left:0.75rem;">
                <strong>${isPt ? "Resposta da Loja:" : "Store Reply:"}</strong> ${escapeHtml(model.review.partnerReply)}
              </blockquote>`
            : ""
        }
      </div>`
    : `<p>${isPt ? "Nenhuma avaliação enviada para este pedido ainda." : "No review submitted for this order yet."}</p>`;

  const casesHtml = model.supportCases
    .map(
      (sc) => `
      <li class="card">
        <strong>#${sc.caseNumber} — ${escapeHtml(sc.subject)}</strong>
        <span class="badge">${escapeHtml(sc.status)}</span>
        <span class="badge">${escapeHtml(sc.priority)}</span>
      </li>`
    )
    .join("");

  const mainContentHtml = `
    <section aria-labelledby="review-heading">
      <h1 id="review-heading">${escapeHtml(model.title)}</h1>
      ${reviewHtml}
      <h2>${escapeHtml(model.supportTitle)}</h2>
      <ul style="list-style:none;padding:0;">${casesHtml}</ul>
    </section>
  `;

  return renderCustomerAppShellHtml({
    locale: model.locale,
    pageTitle: model.title,
    activePath: `/orders/${model.orderId}/review`,
    banner: model.banner,
    mainContentHtml,
  });
}
