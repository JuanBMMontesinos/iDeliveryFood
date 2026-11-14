import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import { authorizeStaffAction } from "@ideliveryfood/authz";
import {
  DEFAULT_LOCALE,
  formatBrlCents,
  formatOperationalTimestamp,
  translateMessage,
  type AuthenticatedActorProfileContract,
  type GovernanceBackofficeOverviewContract,
  type PrivacyRequestRecordContract,
  type RiskAlertContract,
  type StaffRole,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  buildGovernanceAnalyticsConsoleModel,
  buildGovernancePrivacyQueueModel,
  buildGovernanceRiskQueueModel,
  type GovernanceAnalyticsConsoleModel,
  type GovernancePrivacyQueueModel,
  type GovernanceRiskQueueModel,
} from "../../index.js";
import {
  escapeHtml,
  normalizeApiBaseUrl,
  renderAdminRootLayout,
} from "../layout.js";

export type GovernanceSection = "analytics" | "risk" | "privacy";

export interface GovernanceBackofficePageOptions {
  apiBaseUrl: string;
  locale?: SupportedLocale;
  currentPath?:
    | "/governance"
    | "/governance/analytics"
    | "/governance/risk"
    | "/governance/privacy";
  excludeTestData?: boolean;
  getAccessToken?: () => Promise<string | null> | string | null;
  fetchImpl?: typeof fetch;
}

const SECTION_ALLOWED_ROLES: Record<GovernanceSection, readonly StaffRole[]> = {
  analytics: [
    "risk_compliance",
    "auditor_privacy",
    "finance",
    "operations",
    "tech_admin",
  ],
  risk: ["risk_compliance", "auditor_privacy", "operations", "tech_admin"],
  privacy: ["auditor_privacy", "risk_compliance", "tech_admin"],
};

function resolveGovernanceSection(pathname: string): GovernanceSection {
  if (pathname === "/governance/risk") return "risk";
  if (pathname === "/governance/privacy") return "privacy";
  return "analytics";
}

function renderSubNavigation(
  section: GovernanceSection,
  excludeTestData: boolean,
  locale: SupportedLocale
): string {
  const qs = excludeTestData ? "?excludeTestData=true" : "";
  const tabs: Array<{ id: GovernanceSection; href: string; label: string }> = [
    {
      id: "analytics",
      href: `/governance/analytics${qs}`,
      label: locale === "pt-BR" ? "KPIs e Conciliação Ledger" : "KPIs & Ledger",
    },
    {
      id: "risk",
      href: `/governance/risk${qs}`,
      label:
        locale === "pt-BR"
          ? "Motor de Risco Explicável"
          : "Explainable Risk Queue",
    },
    {
      id: "privacy",
      href: `/governance/privacy${qs}`,
      label:
        locale === "pt-BR"
          ? "Governança e LGPD"
          : "LGPD Privacy Requests",
    },
  ];

  const tabLinks = tabs
    .map(
      (t) =>
        `<a class="badge ${t.id === section ? "badge-ok" : "badge-warn"}" href="${escapeHtml(t.href)}" data-testid="governance-tab-${t.id}"${t.id === section ? ' aria-current="page"' : ""}>${escapeHtml(t.label)}</a>`
    )
    .join("\n        ");

  const auditLink = `<a class="badge badge-warn" href="/admin/audit" data-testid="governance-link-audit">${escapeHtml(
    locale === "pt-BR" ? "Logs de Auditoria" : "Audit Logs"
  )}</a>`;

  return `<nav aria-label="${escapeHtml(
    locale === "pt-BR" ? "Subnavegação de governança" : "Governance sub-navigation"
  )}" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">
        ${tabLinks}
        ${auditLink}
      </nav>`;
}

function renderAnalyticsSectionHtml(
  model: GovernanceAnalyticsConsoleModel,
  excludeTestData: boolean,
  locale: SupportedLocale
): string {
  if (!model.authorized || !model.kpis) {
    return `<div class="banner banner-err" role="alert" data-testid="governance-analytics-denied">${escapeHtml(translateMessage("app.state.forbidden", locale))}</div>`;
  }

  const k = model.kpis;
  const regionRowsHtml =
    k.regionalBreakdown.length === 0
      ? `<tr><td colspan="5">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`
      : k.regionalBreakdown
          .map(
            (r) =>
              `<tr data-testid="analytics-region-${escapeHtml(`${r.city}-${r.stateCode}`)}">
                <td><strong>${escapeHtml(`${r.city}/${r.stateCode}`)}</strong></td>
                <td>${r.ordersCount}</td>
                <td>${escapeHtml(formatBrlCents(r.gmvCents, locale))}</td>
                <td>${escapeHtml(formatBrlCents(r.netPlatformRevenueCents, locale))}</td>
                <td>${escapeHtml(formatBrlCents(r.operationalMarginCents, locale))}</td>
              </tr>`
          )
          .join("\n");

  const cancellationRowsHtml =
    k.cancellationBreakdown.length === 0
      ? `<tr><td colspan="4">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`
      : k.cancellationBreakdown
          .map(
            (c) =>
              `<tr data-testid="analytics-cancel-${escapeHtml(c.cancellationReason)}">
                <td>${escapeHtml(c.cancelledByRole)}</td>
                <td><code>${escapeHtml(c.cancellationReason)}</code></td>
                <td>${c.count}</td>
                <td>${(c.shareBps / 100).toFixed(2)}%</td>
              </tr>`
          )
          .join("\n");

  const ledgerBadgeClass = k.isReconciledWithLedger ? "badge-ok" : "badge-err";
  const toggleHref = excludeTestData
    ? "/governance/analytics?excludeTestData=false"
    : "/governance/analytics?excludeTestData=true";
  const toggleLabel = excludeTestData
    ? locale === "pt-BR"
      ? "Mostrando Produção (Incluir Dados de Teste)"
      : "Showing Production Only (Include Test Data)"
    : locale === "pt-BR"
      ? "Incluindo Dados de Teste (Filtrar Produção)"
      : "Including Test Data (Filter Production Only)";

  return `
    <section aria-labelledby="analytics-heading">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
        <h2 id="analytics-heading" style="margin:0;">${escapeHtml(
          locale === "pt-BR"
            ? "KPIs Analíticos Reproduzíveis & Conciliação M13"
            : "Reproducible Analytical KPIs & M13 Ledger Reconciliation"
        )}</h2>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <span class="badge ${ledgerBadgeClass}" data-testid="ledger-reconciliation-badge">
            ${escapeHtml(model.reconciliationBadge)}
          </span>
          <a class="badge badge-warn" href="${escapeHtml(toggleHref)}" data-testid="exclude-test-data-toggle">
            ${escapeHtml(toggleLabel)}
          </a>
        </div>
      </div>

      <div class="grid" style="margin-bottom:1rem;">
        <div class="card">
          <div style="color:#64748b;font-size:0.85rem;">GMV (Captured Orders)</div>
          <div class="kpi" data-testid="kpi-gmv">${escapeHtml(model.formattedGmvBrl)}</div>
        </div>
        <div class="card">
          <div style="color:#64748b;font-size:0.85rem;">${escapeHtml(locale === "pt-BR" ? "Receita Líquida Plataforma" : "Net Platform Revenue")}</div>
          <div class="kpi" data-testid="kpi-net-revenue">${escapeHtml(model.formattedNetRevenueBrl)}</div>
        </div>
        <div class="card">
          <div style="color:#64748b;font-size:0.85rem;">${escapeHtml(locale === "pt-BR" ? "Receita Conciliada Ledger M13" : "M13 Ledger Reconciled")}</div>
          <div class="kpi" data-testid="kpi-ledger-reconciled">${escapeHtml(model.formattedLedgerReconciledNetRevenueBrl)}</div>
        </div>
        <div class="card">
          <div style="color:#64748b;font-size:0.85rem;">${escapeHtml(locale === "pt-BR" ? "Margem Operacional" : "Operational Margin")}</div>
          <div class="kpi" data-testid="kpi-operational-margin">${escapeHtml(model.formattedOperationalMarginBrl)}</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:1rem;">
        <h3>${escapeHtml(locale === "pt-BR" ? "Funil, SLA e Pendentes" : "Funnel, SLAs & Pending Settlement")}</h3>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Métrica" : "Metric")}</th>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Valor" : "Value")}</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Quotes -> Orders</td><td>${k.consumedQuotesCount} / ${k.totalQuotesCount} (${(k.quoteConversionRateBps / 100).toFixed(2)}%)</td></tr>
              <tr><td>Orders (Non-Cancelled / Total)</td><td>${k.nonCancelledOrdersCount} / ${k.totalOrdersCount}</td></tr>
              <tr><td>Cancellation Rate</td><td>${k.cancelledOrdersCount} (${(k.cancellationRateBps / 100).toFixed(2)}%)</td></tr>
              <tr><td>Pending Payment Net Revenue</td><td>${escapeHtml(model.formattedPendingNetRevenueBrl)}</td></tr>
              <tr><td>Average Prep SLA / Delivery SLA</td><td>${k.averagePrepSlaMinutes ?? "—"} min / ${k.averageDeliverySlaMinutes ?? "—"} min</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin-bottom:1rem;">
        <h3>${escapeHtml(locale === "pt-BR" ? "Quebra Regional" : "Regional Breakdown")}</h3>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Região" : "Region")}</th>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Pedidos" : "Orders")}</th>
                <th scope="col">GMV</th>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Receita Líquida" : "Net Revenue")}</th>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Margem" : "Margin")}</th>
              </tr>
            </thead>
            <tbody>${regionRowsHtml}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3>${escapeHtml(locale === "pt-BR" ? "Causas de Cancelamento" : "Cancellation Breakdown")}</h3>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Papel" : "Actor Role")}</th>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Motivo" : "Reason")}</th>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Qtde" : "Count")}</th>
                <th scope="col">Share</th>
              </tr>
            </thead>
            <tbody>${cancellationRowsHtml}</tbody>
          </table>
        </div>
      </div>
    </section>`;
}

function renderRiskSectionHtml(
  model: GovernanceRiskQueueModel,
  locale: SupportedLocale
): string {
  if (!model.authorized) {
    return `<div class="banner banner-err" role="alert" data-testid="governance-risk-denied">${escapeHtml(translateMessage("app.state.forbidden", locale))}</div>`;
  }

  const alertRowsHtml =
    model.alerts.length === 0
      ? `<tr><td colspan="7">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`
      : model.alerts
          .map((a: RiskAlertContract) => {
            const explanationText =
              locale === "pt-BR"
                ? a.ruleExplanation.explanationPtBr
                : a.ruleExplanation.explanationEn;
            const statusClass =
              a.status === "OPEN_AWAITING_HUMAN_REVIEW"
                ? "badge-warn"
                : a.status === "CONFIRMED_BLOCK"
                  ? "badge-err"
                  : "badge-ok";
            return `<tr data-testid="risk-alert-row-${escapeHtml(a.id)}">
              <td><code>${escapeHtml(a.ruleCode)}</code><br><small>${escapeHtml(a.subjectType)}: <code>${escapeHtml(a.subjectId.slice(0, 8))}</code></small></td>
              <td><span class="badge badge-warn">${escapeHtml(a.severity)}</span></td>
              <td><span class="badge ${statusClass}">${escapeHtml(a.status)}</span></td>
              <td>${escapeHtml(explanationText)}<br><small>obs=${a.ruleExplanation.observedValue} vs lim=${a.ruleExplanation.thresholdValue} (${escapeHtml(a.ruleExplanation.windowDescription)})</small></td>
              <td><code>${escapeHtml(a.recommendedAction)}</code></td>
              <td>${escapeHtml(a.reviewDecision ?? "—")}${a.reviewReason ? `<br><small>${escapeHtml(a.reviewReason)}</small>` : ""}</td>
              <td>${a.isTestData ? "TEST" : "PROD"}</td>
            </tr>`;
          })
          .join("\n");

  return `
    <section aria-labelledby="risk-heading">
      <div class="banner banner-ok" data-testid="no-auto-ban-notice">${escapeHtml(model.noAutoBanGuaranteeNotice)}</div>
      <div class="grid" style="margin-bottom:1rem;">
        <div class="card">
          <div style="color:#64748b;font-size:0.85rem;">${escapeHtml(locale === "pt-BR" ? "Aguardando Revisão Humana" : "Awaiting Human Review")}</div>
          <div class="kpi" data-testid="risk-open-count">${model.openAlertsCount}</div>
        </div>
        <div class="card">
          <div style="color:#64748b;font-size:0.85rem;">${escapeHtml(locale === "pt-BR" ? "Bloqueios Confirmados" : "Confirmed Blocks")}</div>
          <div class="kpi" data-testid="risk-confirmed-count">${model.confirmedBlocksCount}</div>
        </div>
        <div class="card">
          <div style="color:#64748b;font-size:0.85rem;">${escapeHtml(locale === "pt-BR" ? "Overrides Aprovados" : "Approved Overrides")}</div>
          <div class="kpi">${model.approvedOverridesCount}</div>
        </div>
        <div class="card">
          <div style="color:#64748b;font-size:0.85rem;">${escapeHtml(locale === "pt-BR" ? "Permissão de Revisão (aal2)" : "Reviewer Capability (aal2)")}</div>
          <div class="kpi">${model.canExecuteHumanReview ? "ENABLED" : "READ-ONLY"}</div>
        </div>
      </div>

      <div class="card">
        <h2 id="risk-heading" style="margin-top:0;">${escapeHtml(
          locale === "pt-BR"
            ? "Alertas de Risco Explicáveis e Decisões Humanas"
            : "Explainable Risk Alerts & Human Review Decisions"
        )}</h2>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Regra / Sujeito" : "Rule / Subject")}</th>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Severidade" : "Severity")}</th>
                <th scope="col">Status</th>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Explicação Determinística" : "Deterministic Explanation")}</th>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Ação Recomendada" : "Recommended Action")}</th>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Revisão Humana" : "Human Review")}</th>
                <th scope="col">Env</th>
              </tr>
            </thead>
            <tbody>${alertRowsHtml}</tbody>
          </table>
        </div>
      </div>
    </section>`;
}

function renderPrivacySectionHtml(
  model: GovernancePrivacyQueueModel,
  locale: SupportedLocale
): string {
  if (!model.authorized) {
    return `<div class="banner banner-err" role="alert" data-testid="governance-privacy-denied">${escapeHtml(translateMessage("app.state.forbidden", locale))}</div>`;
  }

  const reqRowsHtml =
    model.requests.length === 0
      ? `<tr><td colspan="7">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`
      : model.requests
          .map((r: PrivacyRequestRecordContract) => {
            const statusClass =
              r.status === "COMPLETED"
                ? "badge-ok"
                : r.status === "BLOCKED_LEGAL_RETENTION"
                  ? "badge-err"
                  : "badge-warn";
            return `<tr data-testid="privacy-request-row-${escapeHtml(r.id)}">
              <td><code>${escapeHtml(r.id.slice(0, 8))}</code><br><small>user: <code>${escapeHtml(r.userId.slice(0, 8))}</code></small></td>
              <td><code>${escapeHtml(r.requestType)}</code></td>
              <td><span class="badge ${statusClass}">${escapeHtml(r.status)}</span></td>
              <td>${escapeHtml(r.retentionBlockReason ?? "—")}</td>
              <td>${r.holdUntil ? escapeHtml(formatOperationalTimestamp(r.holdUntil, locale)) : "—"}</td>
              <td>${r.anonymizedAt ? escapeHtml(formatOperationalTimestamp(r.anonymizedAt, locale)) : "—"}</td>
              <td>${escapeHtml(r.legalBasisNote ?? "—")}</td>
            </tr>`;
          })
          .join("\n");

  return `
    <section aria-labelledby="privacy-heading">
      <div class="banner banner-ok" data-testid="lgpd-retention-notice">${escapeHtml(model.lgpdRetentionNotice)}</div>
      <div class="grid" style="margin-bottom:1rem;">
        <div class="card">
          <div style="color:#64748b;font-size:0.85rem;">${escapeHtml(locale === "pt-BR" ? "Bloqueios por Retenção Legal" : "Blocked Legal Retention")}</div>
          <div class="kpi" data-testid="privacy-blocked-count">${model.blockedRetentionCount}</div>
        </div>
        <div class="card">
          <div style="color:#64748b;font-size:0.85rem;">${escapeHtml(locale === "pt-BR" ? "Concluídas (Export/Anon)" : "Completed (Export/Anon)")}</div>
          <div class="kpi" data-testid="privacy-completed-count">${model.completedCount}</div>
        </div>
        <div class="card">
          <div style="color:#64748b;font-size:0.85rem;">${escapeHtml(locale === "pt-BR" ? "Pendentes" : "Pending Queue")}</div>
          <div class="kpi" data-testid="privacy-pending-count">${model.pendingCount}</div>
        </div>
      </div>

      <div class="card">
        <h2 id="privacy-heading" style="margin-top:0;">${escapeHtml(
          locale === "pt-BR"
            ? "Solicitações LGPD (Portabilidade JSON e Anonimização PII)"
            : "LGPD Privacy Requests (JSON Portability & PII Anonymization)"
        )}</h2>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th scope="col">ID / User</th>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Tipo" : "Type")}</th>
                <th scope="col">Status</th>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Motivo Retenção" : "Retention Reason")}</th>
                <th scope="col">Hold Until (America/Sao_Paulo)</th>
                <th scope="col">Anonymized At</th>
                <th scope="col">${escapeHtml(locale === "pt-BR" ? "Base Legal" : "Legal Basis")}</th>
              </tr>
            </thead>
            <tbody>${reqRowsHtml}</tbody>
          </table>
        </div>
      </div>
    </section>`;
}

/**
 * Renders the M21 Governance Console (Analytical KPIs, Explainable Risk & LGPD Privacy)
 * directly from live authenticated backend API responses without mocked data.
 */
export async function renderGovernanceBackofficePage(
  options: GovernanceBackofficePageOptions
): Promise<string> {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const currentPath = options.currentPath ?? "/governance/analytics";
  const section = resolveGovernanceSection(currentPath);
  const excludeTestData = Boolean(options.excludeTestData ?? false);
  const pageTitle =
    locale === "pt-BR"
      ? "Governança, KPIs Analíticos, Risco e LGPD"
      : "Governance, Analytical KPIs, Risk & LGPD";

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
      title: pageTitle,
      locale,
      currentPath,
      actor: null,
      mainHtml: `<div class="banner banner-err" role="alert" data-testid="governance-auth-denied">${escapeHtml(translateMessage("app.state.forbidden", locale))}</div>`,
    });
  }

  const routeAuthz = authorizeStaffAction({
    actor,
    allowedRoles: SECTION_ALLOWED_ROLES[section],
    requireMfaAal2: true,
  });
  if (!routeAuthz.allowed) {
    return renderAdminRootLayout({
      title: pageTitle,
      locale,
      currentPath,
      actor,
      mainHtml: `<div class="banner banner-err" role="alert" data-testid="governance-rbac-denied">${escapeHtml(translateMessage(routeAuthz.reasonCode === "DENIED_MFA_STEP_UP_REQUIRED" ? "app.state.mfa_required" : "app.state.forbidden", locale))}</div>`,
    });
  }

  let overview: GovernanceBackofficeOverviewContract;
  try {
    const res = await client.getGovernanceOverview({ excludeTestData });
    overview = res.data;
  } catch (err) {
    const msg =
      err instanceof IDeliveryApiError
        ? `${err.envelope.error.code}: ${err.message}`
        : translateMessage("app.state.error", locale);
    return renderAdminRootLayout({
      title: pageTitle,
      locale,
      currentPath,
      actor,
      mainHtml: `<div class="banner banner-err" role="alert" data-testid="governance-error-banner">${escapeHtml(msg)}</div>`,
    });
  }

  let sectionHtml: string;
  if (section === "risk") {
    sectionHtml = renderRiskSectionHtml(
      buildGovernanceRiskQueueModel({
        actor,
        alerts: overview.riskAlerts,
        locale,
      }),
      locale
    );
  } else if (section === "privacy") {
    sectionHtml = renderPrivacySectionHtml(
      buildGovernancePrivacyQueueModel({
        actor,
        requests: overview.privacyRequests,
        locale,
      }),
      locale
    );
  } else {
    sectionHtml = renderAnalyticsSectionHtml(
      buildGovernanceAnalyticsConsoleModel({
        actor,
        kpis: overview.kpis,
        locale,
      }),
      excludeTestData,
      locale
    );
  }

  const mainHtml = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:0.75rem;">
      <h1 style="margin:0;">${escapeHtml(pageTitle)}</h1>
      <span class="badge badge-ok" data-testid="governance-aal-badge">MFA: ${escapeHtml(actor.aal)}</span>
    </div>
    ${renderSubNavigation(section, excludeTestData, locale)}
    ${sectionHtml}`;

  return renderAdminRootLayout({
    title: pageTitle,
    locale,
    currentPath,
    actor,
    mainHtml,
  });
}
