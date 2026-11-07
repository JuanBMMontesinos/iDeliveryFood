import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  formatBrlCents,
  formatOperationalTimestamp,
  translateMessage,
  type AdminOverviewResponseContract,
  type AuthenticatedActorProfileContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  buildAdminAuditTrailExplorerModel,
  buildAdminGovernanceScreenModel,
  type AdminGovernanceScreenModel,
} from "../../index.js";
import {
  escapeHtml,
  normalizeApiBaseUrl,
  renderAdminRootLayout,
} from "../layout.js";

export type AdminTabKey = "overview" | "approvals" | "scopes" | "audit";

export interface AdminBackofficePageData {
  status: number;
  locale: SupportedLocale;
  tab: AdminTabKey;
  actor: AuthenticatedActorProfileContract | null;
  governanceScreen: AdminGovernanceScreenModel | null;
  overview: AdminOverviewResponseContract | null;
  errorMessage: string | null;
}

export async function loadAdminBackofficePageData(params: {
  apiBaseUrl: string;
  accessToken?: string | null;
  locale?: SupportedLocale;
  tab?: AdminTabKey;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<AdminBackofficePageData> {
  const locale = params.locale ?? DEFAULT_LOCALE;
  const tab = params.tab ?? "overview";
  const client = new IDeliveryApiClient({
    baseUrl: normalizeApiBaseUrl(params.apiBaseUrl),
    locale,
    getAccessToken: () => params.accessToken ?? null,
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
  });

  try {
    const meRes = await client.getMe();
    const actor = meRes.data;
    const governanceScreen = buildAdminGovernanceScreenModel({
      actor,
      locale,
      env: params.env ?? {},
    });

    if (!governanceScreen.authorized) {
      return {
        status: 403,
        locale,
        tab,
        actor,
        governanceScreen,
        overview: null,
        errorMessage: governanceScreen.banner?.message ?? null,
      };
    }

    const overviewRes = await client.getAdminOverview();
    return {
      status: 200,
      locale,
      tab,
      actor,
      governanceScreen,
      overview: overviewRes.data,
      errorMessage: null,
    };
  } catch (err) {
    const status = err instanceof IDeliveryApiError ? err.status : 500;
    const errorMessage =
      err instanceof IDeliveryApiError
        ? `${err.envelope.error.code}: ${err.envelope.error.message}`
        : err instanceof Error
          ? err.message
          : "Unexpected error";
    return {
      status,
      locale,
      tab,
      actor: null,
      governanceScreen: null,
      overview: null,
      errorMessage,
    };
  }
}

export function renderAdminBackofficePageHtml(
  data: AdminBackofficePageData
): string {
  const { locale, tab, actor, governanceScreen, overview } = data;
  const currentPath =
    tab === "overview"
      ? "/admin"
      : tab === "approvals"
        ? "/admin/approvals"
        : tab === "scopes"
          ? "/admin/scopes"
          : "/admin/audit";

  if (!governanceScreen || !governanceScreen.authorized || !overview) {
    const bannerMsg =
      governanceScreen?.banner?.message ??
      data.errorMessage ??
      translateMessage("app.state.forbidden", locale);
    const mainHtml = `
      <section class="card" aria-labelledby="admin-denied-heading">
        <h1 id="admin-denied-heading">${escapeHtml(translateMessage("admin.portal.title", locale))}</h1>
        <div class="banner banner-err" role="alert" data-testid="admin-access-denied-banner">
          ${escapeHtml(bannerMsg)}
        </div>
      </section>`;
    return renderAdminRootLayout({
      title: translateMessage("admin.portal.title", locale),
      locale,
      currentPath,
      actor,
      mainHtml,
    });
  }

  const subNavHtml = `
    <div class="card" style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;">
      <a href="/admin?locale=${escapeHtml(locale)}" class="badge ${tab === "overview" ? "badge-ok" : "badge-warn"}">1. Tenants, Stores &amp; Providers</a>
      <a href="/admin/approvals?locale=${escapeHtml(locale)}" class="badge ${tab === "approvals" ? "badge-ok" : "badge-warn"}">2. Onboarding &amp; KYC Approvals (${overview.approvalEvents.length})</a>
      <a href="/admin/scopes?locale=${escapeHtml(locale)}" class="badge ${tab === "scopes" ? "badge-ok" : "badge-warn"}">3. Staff RBAC/ABAC Scopes (${overview.staffScopes.length})</a>
      <a href="/admin/audit?locale=${escapeHtml(locale)}" class="badge ${tab === "audit" ? "badge-ok" : "badge-warn"}">4. Immutable Audit Trail (${overview.auditLogs.length})</a>
    </div>`;

  const orgRowsHtml = overview.organizations
    .map(
      (org) => `
      <tr>
        <td><code>${escapeHtml(org.slug)}</code></td>
        <td><strong>${escapeHtml(org.tradeName)}</strong><br/><small>${escapeHtml(org.legalName)}</small></td>
        <td><code>${escapeHtml(org.taxId)}</code></td>
        <td><span class="badge badge-ok">${escapeHtml(org.status)}</span></td>
        <td>${org.isMultiUnitEnabled ? "Multi-Unit Enabled" : "Single-Unit"}</td>
      </tr>`
    )
    .join("");

  const storeRowsHtml = overview.stores
    .map(
      (s) => `
      <tr>
        <td><strong>${escapeHtml(s.name)}</strong><br/><small><code>${escapeHtml(s.slug)}</code></small></td>
        <td>${escapeHtml(s.cuisineCategory)}</td>
        <td><span class="badge ${s.status === "ACTIVE" ? "badge-ok" : "badge-warn"}">${escapeHtml(s.status)}</span></td>
        <td>${s.isPublished ? "Published" : "Draft / Unpublished"}</td>
        <td>${s.isPaused ? "PAUSED" : "OPEN"}</td>
        <td>${escapeHtml(s.city)}/${escapeHtml(s.stateCode)}</td>
      </tr>`
    )
    .join("");

  const providerCardsHtml = governanceScreen.providerCards
    .map(
      (p) => `
      <article class="card" data-testid="provider-card-${escapeHtml(p.providerCode)}">
        <h3 style="margin-top:0;">${escapeHtml(p.displayName)} (<code>${escapeHtml(p.providerCode)}</code>)</h3>
        <p><span class="badge ${p.status !== "BLOCKED_MISSING_CREDENTIALS" ? "badge-ok" : "badge-err"}">${escapeHtml(p.status)}</span></p>
        ${p.blockedBadgeText ? `<p style="font-size:0.85rem;color:#991b1b;">${escapeHtml(p.blockedBadgeText)}</p>` : ""}
      </article>`
    )
    .join("");

  const approvalRowsHtml = overview.approvalEvents
    .map(
      (ev) => `
      <tr>
        <td><code>${escapeHtml(ev.targetType)}</code></td>
        <td><code>${escapeHtml(ev.targetId)}</code></td>
        <td>${escapeHtml(ev.previousStatus ?? "NONE")} → <strong>${escapeHtml(ev.newStatus)}</strong></td>
        <td>${escapeHtml(ev.reason)}</td>
        <td>${escapeHtml(formatOperationalTimestamp(ev.createdAtIso, locale))}</td>
      </tr>`
    )
    .join("");

  const scopeRowsHtml = overview.staffScopes
    .map(
      (sc) => `
      <tr>
        <td><strong>${escapeHtml(sc.fullName)}</strong><br/><small>${escapeHtml(sc.email)}</small></td>
        <td><span class="badge badge-ok">${escapeHtml(sc.role)}</span></td>
        <td>${escapeHtml(sc.regionCode ?? "GLOBAL")}</td>
        <td>${escapeHtml(formatBrlCents(sc.maxRefundApprovalCents, locale))}</td>
        <td>${sc.requiresMfa ? "MFA aal2 Required" : "aal1"}</td>
        <td>${escapeHtml(sc.justification ?? "-")}</td>
      </tr>`
    )
    .join("");

  const auditExplorer = actor
    ? buildAdminAuditTrailExplorerModel({
        actor,
        logs: overview.auditLogs,
        locale,
      })
    : null;

  const auditRowsHtml = (auditExplorer?.visibleLogs ?? [])
    .map(
      (log) => `
      <tr>
        <td><code>${escapeHtml(log.action)}</code></td>
        <td><code>${escapeHtml(log.targetType)}:${escapeHtml(log.targetId)}</code></td>
        <td><code>${escapeHtml(log.actorId)}</code></td>
        <td>${escapeHtml(log.reason ?? "-")}</td>
        <td><code>${escapeHtml(log.correlationId)}</code></td>
        <td>${escapeHtml(formatOperationalTimestamp(log.createdAt, locale))}</td>
      </tr>`
    )
    .join("");

  const mainHtml = `
    <h1>${escapeHtml(governanceScreen.portalTitle)}</h1>
    ${subNavHtml}

    <section class="card" aria-labelledby="tenants-heading">
      <h2 id="tenants-heading">Organizations &amp; Stores Cadastre (M16)</h2>
      <h3>Organizations (${overview.organizations.length})</h3>
      <table>
        <thead>
          <tr><th>Slug</th><th>Trade / Legal Name</th><th>CNPJ</th><th>Status</th><th>Multi-Unit</th></tr>
        </thead>
        <tbody>${orgRowsHtml}</tbody>
      </table>
      <h3 style="margin-top:1.25rem;">All Stores Including Draft/Unpublished Units (${overview.stores.length})</h3>
      <table>
        <thead>
          <tr><th>Store</th><th>Category</th><th>Status</th><th>Publication</th><th>Operational</th><th>Location</th></tr>
        </thead>
        <tbody>${storeRowsHtml}</tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="approvals-heading">
      <h2 id="approvals-heading">Onboarding &amp; Cadastre Governance Approvals (${overview.approvalEvents.length})</h2>
      <table>
        <thead>
          <tr><th>Target Type</th><th>Target ID</th><th>Transition</th><th>Justification</th><th>Timestamp (SP)</th></tr>
        </thead>
        <tbody>${approvalRowsHtml}</tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="scopes-heading">
      <h2 id="scopes-heading">Internal Staff RBAC / ABAC Scopes (${overview.staffScopes.length})</h2>
      <div class="banner banner-warn" data-testid="self-grant-prohibition-notice">
        ${escapeHtml(translateMessage("admin.self_grant.blocked", locale))}
      </div>
      <table>
        <thead>
          <tr><th>Staff Member</th><th>Role</th><th>Region</th><th>Max Refund Limit</th><th>MFA Policy</th><th>Justification</th></tr>
        </thead>
        <tbody>${scopeRowsHtml}</tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="audit-heading">
      <h2 id="audit-heading">Audit Logs Explorer</h2>
      <p><span class="badge badge-ok" data-testid="audit-read-only-badge">${escapeHtml(auditExplorer?.readOnlyBadgeText ?? translateMessage("admin.audit.read_only_badge", locale))}</span></p>
      <table>
        <thead>
          <tr><th>Action</th><th>Target</th><th>Actor ID</th><th>Reason</th><th>Correlation ID</th><th>Timestamp (SP)</th></tr>
        </thead>
        <tbody>${auditRowsHtml}</tbody>
      </table>
    </section>

    <section aria-labelledby="providers-heading">
      <h2 id="providers-heading">External Provider Readiness Governance (Option 1 + Option 2)</h2>
      <div class="grid">
        ${providerCardsHtml}
      </div>
    </section>
  `;

  return renderAdminRootLayout({
    title: governanceScreen.portalTitle,
    locale,
    currentPath,
    actor,
    mainHtml,
  });
}
