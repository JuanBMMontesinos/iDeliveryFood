import type { SupportedLocale } from "@ideliveryfood/contracts";
import { DEFAULT_LOCALE } from "@ideliveryfood/contracts";
import { escapeHtml, renderCustomerAppShellHtml } from "../layout.js";
import type { CustomerCheckoutScreenModel } from "../../index.js";

export function renderCustomerCheckoutHtml(
  model: CustomerCheckoutScreenModel,
  locale: SupportedLocale = DEFAULT_LOCALE
): string {
  const isPt = locale === "pt-BR";
  const alertsHtml = [
    model.quoteExpiredNotice
      ? `<div class="ui-state-banner ui-state-error" role="alert" aria-live="assertive">${escapeHtml(model.quoteExpiredNotice)}</div>`
      : "",
    model.pspBlockedNotice
      ? `<div class="ui-state-banner ui-state-error" role="alert" aria-live="assertive">${escapeHtml(model.pspBlockedNotice)}</div>`
      : "",
  ].join("");

  const mainContentHtml = `
    <section class="card" aria-labelledby="checkout-heading">
      <h1 id="checkout-heading">${isPt ? "Finalizar Pedido (Cotação Oficial em BRL)" : "Checkout (Authoritative BRL Quote)"}</h1>
      ${alertsHtml}
      <dl>
        <dt>${isPt ? "Subtotal dos Itens" : "Items Subtotal"}</dt>
        <dd>${escapeHtml(model.subtotalFormatted)}</dd>
        <dt>${isPt ? "Complementos" : "Add-ons"}</dt>
        <dd>${escapeHtml(model.addonsFormatted)}</dd>
        <dt>${isPt ? "Taxa de Serviço" : "Service Fee"}</dt>
        <dd>${escapeHtml(model.serviceFeeFormatted)}</dd>
        <dt>${isPt ? "Taxa de Entrega" : "Delivery Fee"}</dt>
        <dd>${escapeHtml(model.deliveryFeeFormatted)}</dd>
        <dt>${isPt ? "Desconto / Cupom" : "Discount / Coupon"}</dt>
        <dd>- ${escapeHtml(model.discountFormatted)}</dd>
        <dt><strong>${escapeHtml(model.totalLabel)}</strong></dt>
        <dd><strong>${escapeHtml(model.totalFormatted)}</strong></dd>
      </dl>
      <button type="button" ${model.canSubmitPayment ? "" : "disabled"}>
        ${isPt ? "Confirmar e Pagar" : "Confirm & Pay"}
      </button>
    </section>
  `;

  return renderCustomerAppShellHtml({
    locale,
    pageTitle: isPt ? "Checkout" : "Checkout",
    activePath: "/checkout",
    mainContentHtml,
  });
}
