import {
  DEFAULT_LOCALE,
  translateMessage,
  type CartItemSelectionContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { buildUiScreenStateBanner } from "@ideliveryfood/ui-web";
import { escapeHtml, renderCustomerAppShellHtml } from "../layout.js";

export interface CustomerCartRenderModel {
  locale: SupportedLocale;
  storeId: string | null;
  storeName: string | null;
  items: readonly CartItemSelectionContract[];
}

export function renderCustomerCartHtml(model: CustomerCartRenderModel): string {
  const locale = model.locale ?? DEFAULT_LOCALE;
  const isPt = locale === "pt-BR";
  const isEmpty = model.items.length === 0;
  const banner = isEmpty ? buildUiScreenStateBanner({ kind: "empty", locale }) : null;

  const itemsHtml = model.items
    .map(
      (item, idx) => `
      <li class="card">
        <strong>${isPt ? "Produto" : "Product"}: ${escapeHtml(item.productId)}</strong>
        <div>${isPt ? "Quantidade" : "Quantity"}: ${item.quantity}</div>
        <div>${isPt ? "Adicionais selecionados" : "Selected options"}: ${item.selectedOptions.length}</div>
        <small>#${idx + 1}</small>
      </li>`
    )
    .join("");

  const mainContentHtml = `
    <section aria-labelledby="cart-heading">
      <h1 id="cart-heading">${isPt ? "Minha Sacola" : "My Basket"}${model.storeName ? ` — ${escapeHtml(model.storeName)}` : ""}</h1>
      ${
        isEmpty
          ? `<p>${escapeHtml(translateMessage("cart.empty", locale))}</p>`
          : `<ul style="list-style:none;padding:0;">${itemsHtml}</ul>
             <a href="/checkout?locale=${escapeHtml(locale)}" class="btn" style="text-decoration:none;display:inline-block;">${isPt ? "Ir para o Checkout" : "Proceed to Checkout"}</a>`
      }
    </section>
  `;

  return renderCustomerAppShellHtml({
    locale,
    pageTitle: isPt ? "Minha Sacola" : "My Basket",
    activePath: "/cart",
    banner,
    mainContentHtml,
  });
}
