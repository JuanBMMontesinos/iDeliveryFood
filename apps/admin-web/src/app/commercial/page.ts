import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  translateMessage,
  type AuthenticatedActorProfileContract,
  type CommercialBackofficeOverviewContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { buildCommercialBackofficeConsoleModel } from "../../index.js";
import {
  escapeHtml,
  normalizeApiBaseUrl,
  renderAdminRootLayout,
} from "../layout.js";

export interface CommercialBackofficePageData {
  status: number;
  locale: SupportedLocale;
  actor: AuthenticatedActorProfileContract | null;
  overview: CommercialBackofficeOverviewContract | null;
  errorMessage: string | null;
}

export async function loadCommercialBackofficePageData(params: {
  apiBaseUrl: string;
  accessToken?: string | null;
  locale?: SupportedLocale;
  fetchImpl?: typeof fetch;
}): Promise<CommercialBackofficePageData> {
  const locale = params.locale ?? DEFAULT_LOCALE;
  if (!params.accessToken) {
    return {
      status: 401,
      locale,
      actor: null,
      overview: null,
      errorMessage: translateMessage("app.state.forbidden", locale),
    };
  }

  const client = new IDeliveryApiClient({
    baseUrl: normalizeApiBaseUrl(params.apiBaseUrl),
    locale,
    getAccessToken: () => params.accessToken ?? null,
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
  });

  try {
    const [meRes, overviewRes] = await Promise.all([
      client.getMe(),
      client.getCommercialBackofficeOverview(),
    ]);
    return {
      status: 200,
      locale,
      actor: meRes.data,
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
          : translateMessage("app.state.error", locale);
    return {
      status,
      locale,
      actor: null,
      overview: null,
      errorMessage,
    };
  }
}

function formatBpsPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}% (${bps} bps)`;
}

export function renderCommercialBackofficePageHtml(
  data: CommercialBackofficePageData
): string {
  const { locale, actor, overview, errorMessage } = data;
  const title = translateMessage("commercial.console.title", locale);

  if (!actor || !overview) {
    const mainHtml = `
      <section class="card" role="alert" data-testid="commercial-error-banner">
        <h1 class="section-title">${escapeHtml(title)}</h1>
        <p>${escapeHtml(errorMessage ?? translateMessage("app.state.forbidden", locale))}</p>
      </section>
    `;
    return renderAdminRootLayout({
      title,
      locale,
      currentPath: "/commercial",
      actor,
      mainHtml,
    });
  }

  const model = buildCommercialBackofficeConsoleModel({
    actor,
    overview,
    locale,
  });

  if (!model.authorized) {
    const mainHtml = `
      <section class="card" role="alert" data-testid="commercial-forbidden-banner">
        <h1 class="section-title">${escapeHtml(title)}</h1>
        <p>${escapeHtml(translateMessage("app.state.forbidden", locale))}</p>
      </section>
    `;
    return renderAdminRootLayout({
      title,
      locale,
      currentPath: "/commercial",
      actor,
      mainHtml,
    });
  }

  const leadsRowsHtml =
    model.leads.length === 0
      ? `<tr><td colspan="7">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`
      : model.leads
          .map(
            (l) => `
          <tr data-testid="commercial-lead-row-${escapeHtml(l.id)}">
            <td>
              <strong>${escapeHtml(l.tradeName)}</strong><br/>
              <small>${escapeHtml(l.legalName)} · CNPJ/TaxID: <code>${escapeHtml(l.taxId)}</code></small>
            </td>
            <td>${escapeHtml(l.city)} / ${escapeHtml(l.stateCode)}<br/><small>${escapeHtml(l.cuisineCategory)}</small></td>
            <td><code>${escapeHtml(l.contactEmail)}</code><br/><small>${escapeHtml(l.contactPhone)}</small></td>
            <td><span class="badge ${l.status === "CONVERTED" ? "badge-ok" : "badge-warn"}">${escapeHtml(l.status)}</span></td>
            <td><code>${escapeHtml(l.legalBasis)}</code></td>
            <td>${l.convertedOrganizationId ? `<code>${escapeHtml(l.convertedOrganizationId)}</code>` : "—"}</td>
            <td>
              <button type="button" class="btn-secondary btn-lead-qualify" data-lead-id="${escapeHtml(l.id)}">
                ${locale === "pt-BR" ? "Qualificar" : "Qualify"}
              </button>
              <button type="button" class="btn-secondary btn-lead-negotiate" data-lead-id="${escapeHtml(l.id)}">
                ${locale === "pt-BR" ? "Negociação" : "Negotiate"}
              </button>
            </td>
          </tr>`
          )
          .join("");

  const proposalsRowsHtml =
    model.proposals.length === 0
      ? `<tr><td colspan="7">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`
      : model.proposals
          .map(
            (p) => `
          <tr data-testid="commercial-proposal-row-${escapeHtml(p.id)}">
            <td><code>${escapeHtml(p.id)}</code><br/><small>v${p.proposalVersion} · Lead: <code>${escapeHtml(p.leadId)}</code></small></td>
            <td>
              Marketplace: <strong>${escapeHtml(formatBpsPercent(p.platformDeliveryCommissionBps))}</strong><br/>
              Own Delivery: ${escapeHtml(formatBpsPercent(p.merchantDeliveryCommissionBps))} · Pickup: ${escapeHtml(formatBpsPercent(p.pickupCommissionBps))}
            </td>
            <td>${escapeHtml(formatBpsPercent(p.serviceFeeBps))}</td>
            <td>${p.payoutCycleDays}d</td>
            <td><span class="badge ${p.legalTemplateStatus === "APPROVED_TEMPLATE" ? "badge-ok" : "badge-warn"}">${escapeHtml(p.legalTemplateStatus)}</span></td>
            <td><span class="badge ${p.status === "ACCEPTED" ? "badge-ok" : "badge-warn"}">${escapeHtml(p.status)}</span></td>
            <td>
              ${
                p.status !== "ACCEPTED"
                  ? `<button type="button" class="btn-primary btn-convert-proposal" data-proposal-id="${escapeHtml(p.id)}">
                      ${locale === "pt-BR" ? "Converter em Tenant + Contrato" : "Convert to Tenant + Contract"}
                    </button>`
                  : `<span class="badge badge-ok">${locale === "pt-BR" ? "Convertida" : "Converted"}</span>`
              }
            </td>
          </tr>`
          )
          .join("");

  const contractsRowsHtml =
    model.contracts.length === 0
      ? `<tr><td colspan="7">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`
      : model.contracts
          .map(
            (c) => `
          <tr data-testid="commercial-contract-row-${escapeHtml(c.id)}">
            <td><code>${escapeHtml(c.id)}</code></td>
            <td><code>${escapeHtml(c.organizationId)}</code></td>
            <td><strong>v${c.versionNumber}</strong></td>
            <td>
              ${escapeHtml(formatBpsPercent(c.platformDeliveryCommissionBps))} /
              ${escapeHtml(formatBpsPercent(c.merchantDeliveryCommissionBps))} /
              ${escapeHtml(formatBpsPercent(c.pickupCommissionBps))}
            </td>
            <td>${c.payoutCycleDays}d</td>
            <td><span class="badge ${c.legalTemplateStatus === "APPROVED_TEMPLATE" ? "badge-ok" : "badge-warn"}">${escapeHtml(c.legalTemplateStatus)}</span></td>
            <td>
              ${
                c.acceptedByPartnerOwnerId
                  ? `<span class="badge badge-ok" data-testid="contract-accepted-badge-${escapeHtml(c.id)}">${locale === "pt-BR" ? "Aceito pelo Owner" : "Accepted by Owner"} (${escapeHtml(c.acceptedByPartnerOwnerId)})</span>`
                  : `<span class="badge badge-warn">${locale === "pt-BR" ? "Aguardando Aceite do Owner" : "Pending Partner Owner Acceptance"}</span>`
              }
            </td>
          </tr>`
          )
          .join("");

  const rulesRowsHtml =
    model.commissionRuleVersions.length === 0
      ? `<tr><td colspan="6">${escapeHtml(translateMessage("app.state.empty", locale))}</td></tr>`
      : model.commissionRuleVersions
          .map(
            (r) => `
          <tr data-testid="commission-rule-row-${escapeHtml(r.id)}">
            <td><code>${escapeHtml(r.id)}</code></td>
            <td><code>${escapeHtml(r.organizationId)}</code></td>
            <td><code>${escapeHtml(r.contractId)}</code> (v${r.versionNumber})</td>
            <td>
              Mkt: <strong>${escapeHtml(formatBpsPercent(r.platformDeliveryCommissionBps))}</strong> ·
              Merchant: ${escapeHtml(formatBpsPercent(r.merchantDeliveryCommissionBps))} ·
              Pickup: ${escapeHtml(formatBpsPercent(r.pickupCommissionBps))}
            </td>
            <td>${escapeHtml(formatBpsPercent(r.serviceFeeBps))}</td>
            <td><small>${escapeHtml(r.effectiveFromIso)}${r.effectiveUntilIso ? ` → ${escapeHtml(r.effectiveUntilIso)}` : " (ACTIVE)"}</small></td>
          </tr>`
          )
          .join("");

  const mainHtml = `
    <section class="card" data-testid="commercial-overview-header">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
        <div>
          <h1 class="section-title" style="margin:0;">${escapeHtml(title)}</h1>
          <p style="margin:0.25rem 0 0;color:var(--muted);">
            ${escapeHtml(model.legalTemplateNotice)}
          </p>
        </div>
        <div>
          <span class="badge badge-warn" data-testid="commercial-segregation-badge">
            ${escapeHtml(model.segregationNotice)}
          </span>
        </div>
      </div>

      <div class="grid-cards" style="margin-top:1rem;">
        <div class="stat-box">
          <div class="stat-label">${locale === "pt-BR" ? "Leads no Pipeline" : "Pipeline Leads"}</div>
          <div class="stat-value" data-testid="metric-leads-count">${model.leads.length}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">${locale === "pt-BR" ? "Propostas Comerciais" : "Commercial Proposals"}</div>
          <div class="stat-value" data-testid="metric-proposals-count">${model.proposals.length}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">${locale === "pt-BR" ? "Contratos Versionados" : "Versioned Contracts"}</div>
          <div class="stat-value" data-testid="metric-contracts-count">${model.contracts.length}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">${locale === "pt-BR" ? "Regras de Comissão Ativas" : "Active Commission Rules"}</div>
          <div class="stat-value" data-testid="metric-rules-count">${model.activeCommissionRulesCount}</div>
        </div>
      </div>
    </section>

    <section class="card" style="margin-top:1.25rem;" data-testid="commercial-leads-section">
      <h2 class="section-title">${locale === "pt-BR" ? "Funil de Leads B2B (commercial_leads)" : "B2B Leads Pipeline (commercial_leads)"}</h2>
      <form id="create-lead-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.75rem;margin-bottom:1rem;">
        <input type="text" name="legalName" placeholder="${locale === "pt-BR" ? "Razão Social" : "Legal Name"}" required />
        <input type="text" name="tradeName" placeholder="${locale === "pt-BR" ? "Nome Fantasia" : "Trade Name"}" required />
        <input type="text" name="taxId" placeholder="CNPJ (14 dígitos)" required />
        <input type="email" name="contactEmail" placeholder="E-mail" required />
        <input type="text" name="contactPhone" placeholder="Telefone (+5511...)" required />
        <input type="text" name="cuisineCategory" placeholder="${locale === "pt-BR" ? "Categoria (ex.: PIZZA)" : "Category (e.g. PIZZA)"}" value="RESTAURANT" required />
        <button type="submit" class="btn-primary">${locale === "pt-BR" ? "Cadastrar Lead" : "Create Lead"}</button>
      </form>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>${locale === "pt-BR" ? "Parceiro / CNPJ" : "Partner / Tax ID"}</th>
              <th>${locale === "pt-BR" ? "Cidade / Categoria" : "City / Category"}</th>
              <th>${locale === "pt-BR" ? "Contato" : "Contact"}</th>
              <th>Status</th>
              <th>${locale === "pt-BR" ? "Base Legal LGPD" : "LGPD Legal Basis"}</th>
              <th>Organization ID</th>
              <th>${locale === "pt-BR" ? "Ações" : "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            ${leadsRowsHtml}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card" style="margin-top:1.25rem;" data-testid="commercial-proposals-section">
      <h2 class="section-title">${locale === "pt-BR" ? "Propostas Comerciais e Conversão (commercial_proposals)" : "Commercial Proposals & Onboarding Conversion (commercial_proposals)"}</h2>
      <form id="create-proposal-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.75rem;margin-bottom:1rem;">
        <input type="text" name="leadId" placeholder="Lead ID" required />
        <input type="number" name="platformDeliveryCommissionBps" placeholder="Marketplace BPS (2100)" value="2100" min="0" max="5000" required />
        <input type="number" name="merchantDeliveryCommissionBps" placeholder="Own Delivery BPS (1100)" value="1100" min="0" max="5000" required />
        <input type="number" name="pickupCommissionBps" placeholder="Pickup BPS (900)" value="900" min="0" max="5000" required />
        <input type="number" name="serviceFeeBps" placeholder="Service Fee BPS (500)" value="500" min="0" max="2000" required />
        <select name="payoutCycleDays">
          <option value="7">7 dias</option>
          <option value="14">14 dias</option>
          <option value="30">30 dias</option>
          <option value="1">1 dia</option>
        </select>
        <button type="submit" class="btn-primary">${locale === "pt-BR" ? "Emitir Proposta" : "Issue Proposal"}</button>
      </form>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Proposal / Lead</th>
              <th>${locale === "pt-BR" ? "Comissões por Modalidade" : "Commissions by Modality"}</th>
              <th>Service Fee</th>
              <th>Repasse</th>
              <th>Template</th>
              <th>Status</th>
              <th>${locale === "pt-BR" ? "Conversão" : "Conversion"}</th>
            </tr>
          </thead>
          <tbody>
            ${proposalsRowsHtml}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card" style="margin-top:1.25rem;" data-testid="commercial-contracts-section">
      <h2 class="section-title">${locale === "pt-BR" ? "Contratos Versionados (merchant_contracts)" : "Versioned Merchant Contracts (merchant_contracts)"}</h2>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Contract ID</th>
              <th>Organization ID</th>
              <th>${locale === "pt-BR" ? "Versão" : "Version"}</th>
              <th>Mkt / Own / Pickup</th>
              <th>Cycle</th>
              <th>Legal Status</th>
              <th>${locale === "pt-BR" ? "Aceite Formal (partner_owner)" : "Formal Acceptance (partner_owner)"}</th>
            </tr>
          </thead>
          <tbody>
            ${contractsRowsHtml}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card" style="margin-top:1.25rem;" data-testid="commercial-commission-rules-section">
      <h2 class="section-title">${locale === "pt-BR" ? "Regras de Comissão por Versão e Vigência (commission_rule_versions)" : "Versioned Commission Rules (commission_rule_versions)"}</h2>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Rule ID</th>
              <th>Organization ID</th>
              <th>Contract / Version</th>
              <th>${locale === "pt-BR" ? "Taxas de Comissão" : "Commission Rates"}</th>
              <th>Service Fee</th>
              <th>${locale === "pt-BR" ? "Vigência" : "Effective Window"}</th>
            </tr>
          </thead>
          <tbody>
            ${rulesRowsHtml}
          </tbody>
        </table>
      </div>
    </section>
  `;

  return renderAdminRootLayout({
    title,
    locale,
    currentPath: "/commercial",
    actor,
    mainHtml,
  });
}
