import type { LocalizedStoreCardViewModel, UiScreenStateBanner, LanguageSelectorViewModel } from "@ideliveryfood/ui-web";
import { escapeHtml, renderCustomerAppShellHtml } from "./layout.js";

export interface CustomerMarketplaceRenderModel {
  brandTitle: string;
  heading: string;
  localeSelector: LanguageSelectorViewModel;
  banner: UiScreenStateBanner | null;
  stores: LocalizedStoreCardViewModel[];
}

export function renderCustomerMarketplaceHtml(model: CustomerMarketplaceRenderModel): string {
  const locale = model.localeSelector.activeLocale;
  const storesHtml = model.stores
    .map(
      (store) => `
      <article class="card" aria-labelledby="store-title-${escapeHtml(store.id)}">
        <h2 id="store-title-${escapeHtml(store.id)}">
          <a href="/stores/${escapeHtml(store.slug)}?locale=${escapeHtml(locale)}" style="color:var(--text-primary);text-decoration:none;">
            ${escapeHtml(store.name)}
          </a>
        </h2>
        <p>${escapeHtml(store.description)}</p>
        <div>
          <span class="badge">${escapeHtml(store.minOrderFormatted)}</span>
          <span class="badge">${escapeHtml(store.prepTimeFormatted)}</span>
          ${store.modalityBadges.map((b) => `<span class="badge">${escapeHtml(b)}</span>`).join("")}
        </div>
      </article>`
    )
    .join("");

  const mainContentHtml = `
    <section aria-labelledby="marketplace-heading">
      <h1 id="marketplace-heading">${escapeHtml(model.heading)}</h1>
      <form method="GET" action="/" role="search" style="margin-bottom:1.25rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
        <input type="hidden" name="locale" value="${escapeHtml(locale)}" />
        <label for="search-input" class="skip-link">${locale === "pt-BR" ? "Buscar restaurantes" : "Search restaurants"}</label>
        <input id="search-input" name="search" type="search" placeholder="${locale === "pt-BR" ? "Buscar restaurante ou prato..." : "Search restaurant or dish..."}" />
        <button type="submit">${locale === "pt-BR" ? "Buscar" : "Search"}</button>
      </form>
      <div>${storesHtml}</div>
    </section>
  `;

  return renderCustomerAppShellHtml({
    locale,
    pageTitle: model.heading,
    activePath: "/",
    banner: model.banner,
    mainContentHtml,
  });
}
