import type { IDeliveryApiClient } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  type AuthenticatedActorProfileContract,
  type SignedUploadUrlResponseContract,
  type StoreDetailResponseContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  escapeHtml,
  formatBrlCents,
  renderPartnerLayoutHtml,
} from "../layout.js";

export interface PartnerCatalogScreenModel {
  locale: SupportedLocale;
  actor: AuthenticatedActorProfileContract;
  storeDetail: StoreDetailResponseContract;
  mediaUploadIntent: SignedUploadUrlResponseContract | null;
}

export async function loadPartnerCatalogScreen(params: {
  apiClient: IDeliveryApiClient;
  storeId: string;
  requestMediaFileName?: string;
  locale?: SupportedLocale;
}): Promise<PartnerCatalogScreenModel> {
  const [meRes, storeRes] = await Promise.all([
    params.apiClient.getMe(),
    params.apiClient.getStoreDetail(params.storeId),
  ]);

  const locale = params.locale ?? meRes.data.preferredLocale ?? DEFAULT_LOCALE;
  let mediaUploadIntent: SignedUploadUrlResponseContract | null = null;

  if (params.requestMediaFileName) {
    const uploadRes = await params.apiClient.createSignedUploadUrl({
      bucket: "catalog-media",
      storeId: storeRes.data.store.id,
      fileName: params.requestMediaFileName,
      mimeType: "image/webp",
      fileSizeBytes: 184_320,
    });
    mediaUploadIntent = uploadRes.data;
  }

  return {
    locale,
    actor: meRes.data,
    storeDetail: storeRes.data,
    mediaUploadIntent,
  };
}

export function renderPartnerCatalogHtml(model: PartnerCatalogScreenModel): string {
  const { locale, actor, storeDetail, mediaUploadIntent } = model;
  const isPt = locale === "pt-BR";
  const store = storeDetail.store;

  const categoriesHtml = storeDetail.categories
    .map((cat) => {
      const catName = isPt ? cat.namePtBr : cat.nameEn;

      const productsRows = cat.products
        .map((prod) => {
          const prodName = isPt ? prod.namePtBr : prod.nameEn;
          const groupDescriptions = prod.optionGroups
            .map((g) => {
              const gName = isPt ? g.namePtBr : g.nameEn;
              return `${escapeHtml(gName)} (min ${g.minSelections} / max ${g.maxSelections}, ${g.options.length} itens)`;
            })
            .join("; ");

          return `
            <tr data-testid="catalog-product-row-${escapeHtml(prod.id)}">
              <td><strong>${escapeHtml(prodName)}</strong></td>
              <td>${escapeHtml(formatBrlCents(prod.priceCents, locale))}</td>
              <td>
                <span class="badge ${prod.isAvailable && !prod.isPaused ? "badge--open" : "badge--closed"}">
                  ${prod.isAvailable && !prod.isPaused ? (isPt ? "Disponível" : "Available") : isPt ? "Pausado" : "Unavailable"}
                </span>
              </td>
              <td>${groupDescriptions || "—"}</td>
            </tr>
          `;
        })
        .join("");

      return `
        <article class="card" data-testid="catalog-category-${escapeHtml(cat.id)}">
          <h2 style="margin-top:0;">
            ${escapeHtml(catName)}
            <span class="badge">${cat.isActive ? (isPt ? "Ativa" : "Active") : isPt ? "Inativa" : "Inactive"}</span>
          </h2>
          <table class="data-table">
            <thead>
              <tr>
                <th>${isPt ? "Produto" : "Product"}</th>
                <th>${isPt ? "Preço (Centavos BRL)" : "Price (BRL Cents)"}</th>
                <th>${isPt ? "Disponibilidade" : "Availability"}</th>
                <th>${isPt ? "Grupos de Complementos (min/max)" : "Option Groups (min/max)"}</th>
              </tr>
            </thead>
            <tbody>
              ${productsRows}
            </tbody>
          </table>
        </article>
      `;
    })
    .join("");

  const bodyHtml = `
    <section aria-labelledby="catalog-heading">
      <div class="card">
        <h1 id="catalog-heading" style="margin-top:0;">
          ${isPt ? "Gestor Visual de Cardápio & Complementos (M04/M07)" : "Visual Catalog & Modifiers Manager (M04/M07)"}
        </h1>
        <p>
          ${
            isPt
              ? "Gerencie categorias, produtos, preços em centavos BRL, grupos de complementos (min/max) e imagens no bucket público catalog-media."
              : "Manage categories, products, prices in BRL cents, option groups (min/max), and images in the public catalog-media bucket."
          }
        </p>
        ${
          mediaUploadIntent
            ? `<div data-testid="catalog-media-upload-intent">
                <strong>Signed Upload Path:</strong> <code>${escapeHtml(mediaUploadIntent.objectPath)}</code>
              </div>`
            : ""
        }
      </div>
      ${categoriesHtml}
    </section>
  `;

  return renderPartnerLayoutHtml({
    title: isPt ? "Gestão de Cardápio" : "Catalog Management",
    locale,
    activeRoute: "/catalog",
    actorSummary: `${actor.fullName} (${actor.email})`,
    storeName: store.name,
    bodyHtml,
  });
}
