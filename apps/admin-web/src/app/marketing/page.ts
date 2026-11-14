import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  formatBrlCents,
  translateMessage,
  type AuthenticatedActorProfileContract,
  type MarketingBackofficeOverviewContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { buildMarketingBackofficeConsoleModel } from "../../index.js";
import {
  escapeHtml,
  normalizeApiBaseUrl,
  renderAdminRootLayout,
} from "../layout.js";

export interface MarketingBackofficePageOptions {
  apiBaseUrl: string;
  locale?: SupportedLocale;
  getAccessToken?: () => Promise<string | null> | string | null;
  fetchImpl?: typeof fetch;
}

export async function renderMarketingBackofficePage(
  options: MarketingBackofficePageOptions
): Promise<string> {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const client = new IDeliveryApiClient({
    baseUrl: normalizeApiBaseUrl(options.apiBaseUrl),
    locale,
    ...(options.getAccessToken ? { getAccessToken: options.getAccessToken } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  let actor: AuthenticatedActorProfileContract;
  try {
    const meRes = await client.getMe();
    actor = meRes.data;
  } catch {
    return renderAdminRootLayout({
      title: translateMessage("marketing.console.title", locale),
      locale,
      currentPath: "/marketing",
      actor: null,
      mainHtml: `<div class="banner banner-err" role="alert">${escapeHtml(translateMessage("app.state.forbidden", locale))}</div>`,
    });
  }

  let overview: MarketingBackofficeOverviewContract;
  try {
    const res = await client.getMarketingBackofficeOverview();
    overview = res.data;
  } catch (err) {
    const msg =
      err instanceof IDeliveryApiError
        ? `${err.envelope.error.code}: ${err.message}`
        : translateMessage("app.state.error", locale);
    return renderAdminRootLayout({
      title: translateMessage("marketing.console.title", locale),
      locale,
      currentPath: "/marketing",
      actor,
      mainHtml: `<div class="banner banner-err" role="alert" data-testid="marketing-error-banner">${escapeHtml(msg)}</div>`,
    });
  }

  const model = buildMarketingBackofficeConsoleModel({
    actor,
    overview,
    locale,
  });

  const promoRowsHtml =
    model.promotions.length === 0
      ? `<tr><td colspan="7">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`
      : model.promotions
          .map((p) => {
            const discountText =
              p.discountType === "FIXED_CENTS"
                ? formatBrlCents(p.discountValue, locale)
                : `${(p.discountValue / 100).toFixed(2)}% (max ${formatBrlCents(p.maxDiscountCents, locale)})`;
            const remainingCents = Math.max(0, p.budgetLimitCents - p.budgetConsumedCents);
            return `<tr data-testid="promotion-row-${escapeHtml(p.id)}">
              <td><strong>${escapeHtml(p.code)}</strong></td>
              <td><span class="badge badge-ok">${escapeHtml(p.fundedBy)} (${(p.platformShareBps / 100).toFixed(0)}% plat)</span></td>
              <td>${escapeHtml(discountText)}</td>
              <td>${escapeHtml(formatBrlCents(p.minOrderCents, locale))}</td>
              <td>${escapeHtml(formatBrlCents(p.budgetConsumedCents, locale))} / ${escapeHtml(formatBrlCents(p.budgetLimitCents, locale))} (${escapeHtml(formatBrlCents(remainingCents, locale))} disp.)</td>
              <td>${p.maxUsesPerUser}x ${p.firstOrderOnly ? "(1st order)" : ""}</td>
              <td><span class="badge ${p.isActive ? "badge-ok" : "badge-warn"}">${p.isActive ? "ACTIVE" : "INACTIVE"}</span></td>
            </tr>`;
          })
          .join("\n");

  const redemptionRowsHtml =
    model.redemptions.length === 0
      ? `<tr><td colspan="6">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`
      : model.redemptions
          .map(
            (r) => `<tr data-testid="redemption-row-${escapeHtml(r.id)}">
              <td><code>${escapeHtml(r.id.slice(0, 8))}</code></td>
              <td><code>${escapeHtml(r.promotionId.slice(0, 8))}</code></td>
              <td><span class="badge badge-ok">${escapeHtml(r.status)}</span></td>
              <td>${escapeHtml(formatBrlCents(r.discountAppliedCents, locale))}</td>
              <td>${escapeHtml(formatBrlCents(r.platformSubsidyCents, locale))}</td>
              <td>${escapeHtml(formatBrlCents(r.merchantSubsidyCents, locale))}</td>
            </tr>`
          )
          .join("\n");

  const reviewRowsHtml =
    model.reviews.length === 0
      ? `<tr><td colspan="6">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`
      : model.reviews
          .map(
            (rev) => `<tr data-testid="review-moderation-row-${escapeHtml(rev.id)}">
              <td><code>${escapeHtml(rev.orderId.slice(0, 8))}</code></td>
              <td><strong>${rev.rating} / 5 ★</strong></td>
              <td>${escapeHtml(rev.comment ?? "—")}</td>
              <td>${escapeHtml(rev.partnerReply ?? "—")}</td>
              <td><span class="badge ${rev.moderationStatus === "PUBLISHED" ? "badge-ok" : "badge-warn"}">${escapeHtml(rev.moderationStatus)}</span></td>
              <td>${escapeHtml(rev.moderationReason ?? "—")}</td>
            </tr>`
          )
          .join("\n");

  const mainHtml = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:1rem;">
      <h1 style="margin:0;">${escapeHtml(translateMessage("marketing.console.title", locale))}</h1>
      <div style="display:flex;gap:0.5rem;">
        <span class="badge badge-warn" data-testid="sponsored-ads-flag-badge">
          Sponsored Ads: ${overview.featureSponsoredAdsEnabled ? "ENABLED" : "DISABLED (Policy Gate)"}
        </span>
        <span class="badge badge-warn" data-testid="subscriptions-flag-badge">
          Subscriptions: ${overview.featureSubscriptionsEnabled ? "ENABLED" : "DISABLED (Policy Gate)"}
        </span>
      </div>
    </div>

    <div class="banner banner-info" data-testid="marketing-budget-guard-banner">
      ${escapeHtml(model.budgetGuardNotice)}
    </div>
    <div class="banner banner-warn" data-testid="marketing-moderation-banner">
      ${escapeHtml(model.reviewModerationNotice)}
    </div>

    <div class="grid" style="margin-bottom:1.25rem;">
      <div class="card">
        <div style="color:var(--muted);font-size:0.85rem;">Active Promotions</div>
        <div style="font-size:1.5rem;font-weight:700;" data-testid="marketing-promotions-count">${model.promotions.length}</div>
      </div>
      <div class="card">
        <div style="color:var(--muted);font-size:0.85rem;">Total Redemptions</div>
        <div style="font-size:1.5rem;font-weight:700;" data-testid="marketing-redemptions-count">${model.redemptions.length}</div>
      </div>
      <div class="card">
        <div style="color:var(--muted);font-size:0.85rem;">Verified Order Reviews</div>
        <div style="font-size:1.5rem;font-weight:700;" data-testid="marketing-reviews-count">${model.reviews.length} (${model.publishedAverageRating.toFixed(2)} ★)</div>
      </div>
    </div>

    <section class="card" aria-labelledby="promotions-heading">
      <h2 id="promotions-heading" style="margin-top:0;">${locale === "pt-BR" ? "Campanhas e Cupons com Controle Atômico de Orçamento (M19)" : "Promotion Campaigns & Atomic Budget Guard (M19)"}</h2>
      <table data-testid="promotions-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Subsidy Funding</th>
            <th>Discount</th>
            <th>Min Order</th>
            <th>Atomic Budget (Consumed / Limit)</th>
            <th>User Cap</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${promoRowsHtml}
        </tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="redemptions-heading">
      <h2 id="redemptions-heading" style="margin-top:0;">${locale === "pt-BR" ? "Resgates e Rateio de Subsídio (Plataforma vs. Parceiro)" : "Coupon Redemptions & Subsidy Split (Platform vs. Merchant)"}</h2>
      <table data-testid="redemptions-table">
        <thead>
          <tr>
            <th>Redemption</th>
            <th>Promotion</th>
            <th>Status</th>
            <th>Discount Applied</th>
            <th>Platform Subsidy</th>
            <th>Merchant Subsidy</th>
          </tr>
        </thead>
        <tbody>
          ${redemptionRowsHtml}
        </tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="reviews-moderation-heading">
      <h2 id="reviews-moderation-heading" style="margin-top:0;">${locale === "pt-BR" ? "Avaliações Verificadas e Moderação Auditada" : "Verified Order Reviews & Audited Moderation"}</h2>
      <table data-testid="reviews-moderation-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Rating</th>
            <th>Customer Comment</th>
            <th>Partner Reply</th>
            <th>Moderation Status</th>
            <th>Moderation Reason</th>
          </tr>
        </thead>
        <tbody>
          ${reviewRowsHtml}
        </tbody>
      </table>
    </section>
  `;

  return renderAdminRootLayout({
    title: translateMessage("marketing.console.title", locale),
    locale,
    currentPath: "/marketing",
    actor,
    mainHtml,
  });
}
