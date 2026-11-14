import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  formatBrlCents,
  formatOperationalTimestamp,
  translateMessage,
  type AuthenticatedActorProfileContract,
  type SupportBackofficeOverviewContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  buildSupportBackofficeConsoleModel,
  type SupportBackofficeConsoleModel,
} from "../../index.js";
import {
  escapeHtml,
  normalizeApiBaseUrl,
  renderAdminRootLayout,
} from "../layout.js";

export interface SupportBackofficePageData {
  status: number;
  locale: SupportedLocale;
  actor: AuthenticatedActorProfileContract | null;
  supportModel: SupportBackofficeConsoleModel | null;
  overview: SupportBackofficeOverviewContract | null;
  errorMessage: string | null;
}

export async function loadSupportBackofficePageData(params: {
  apiBaseUrl: string;
  accessToken?: string | null;
  locale?: SupportedLocale;
  fetchImpl?: typeof fetch;
}): Promise<SupportBackofficePageData> {
  const locale = params.locale ?? DEFAULT_LOCALE;
  const client = new IDeliveryApiClient({
    baseUrl: normalizeApiBaseUrl(params.apiBaseUrl),
    locale,
    getAccessToken: () => params.accessToken ?? null,
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
  });

  try {
    const meRes = await client.getMe();
    const actor = meRes.data;

    const supRes = await client.getSupportBackofficeOverview();
    const overview = supRes.data;
    const supportModel = buildSupportBackofficeConsoleModel({
      actor,
      overview,
      locale,
    });

    if (!supportModel.authorized) {
      return {
        status: 403,
        locale,
        actor,
        supportModel,
        overview: null,
        errorMessage: translateMessage("app.state.forbidden", locale),
      };
    }

    return {
      status: 200,
      locale,
      actor,
      supportModel,
      overview,
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
      actor: null,
      supportModel: null,
      overview: null,
      errorMessage,
    };
  }
}

export function renderSupportBackofficePageHtml(
  data: SupportBackofficePageData
): string {
  const { locale, actor, supportModel, overview } = data;
  const isPt = locale === "pt-BR";

  if (!supportModel || !supportModel.authorized || !overview) {
    const bannerMsg =
      data.errorMessage ?? translateMessage("app.state.forbidden", locale);
    const mainHtml = `
      <section class="card" aria-labelledby="support-denied-heading">
        <h1 id="support-denied-heading">${
          isPt
            ? "Console de Suporte, SLA e Escalonamento (M17)"
            : "Support, SLA & Escalation Console (M17)"
        }</h1>
        <div class="banner banner-err" role="alert" data-testid="support-access-denied-banner">
          ${escapeHtml(bannerMsg)}
        </div>
      </section>`;
    return renderAdminRootLayout({
      title: isPt ? "Suporte e SLA (M17)" : "Support & SLA Console (M17)",
      locale,
      currentPath: "/support",
      actor,
      mainHtml,
    });
  }

  const caseRowsHtml = supportModel.cases
    .map(
      (c) => `
      <tr>
        <td><strong>#${c.caseNumber}</strong><br/><small><code>${escapeHtml(c.id)}</code></small></td>
        <td>${escapeHtml(c.subject)}<br/><small>Category: <code>${escapeHtml(c.category)}</code></small></td>
        <td><span class="badge ${c.priority === "CRITICAL_IN_ROUTE" || c.priority === "CRITICAL" ? "badge-err" : "badge-warn"}">${escapeHtml(c.priority)}</span></td>
        <td><span class="badge ${c.status === "RESOLVED" || c.status === "CLOSED" ? "badge-ok" : "badge-warn"}">${escapeHtml(c.status)}</span></td>
        <td><code>${escapeHtml(c.requesterRole)}</code> (${escapeHtml(c.requesterId.slice(0, 8))})</td>
        <td><code>${escapeHtml(c.orderId ?? "N/A")}</code><br/><small>Task: <code>${escapeHtml(c.deliveryTaskId ?? "N/A")}</code></small></td>
        <td>${escapeHtml(formatOperationalTimestamp(c.slaDueAtIso, locale))}</td>
      </tr>`
    )
    .join("");

  const messageRowsHtml = supportModel.messages
    .map(
      (m) => `
      <tr>
        <td><code>${escapeHtml(m.caseId.slice(0, 8))}</code></td>
        <td><code>${escapeHtml(m.senderId.slice(0, 8))}</code></td>
        <td>${escapeHtml(m.body)}</td>
        <td><span class="badge ${m.isInternalNote ? "badge-warn" : "badge-ok"}">${
          m.isInternalNote ? "INTERNAL_STAFF_NOTE" : "PUBLIC_THREAD"
        }</span></td>
        <td>${escapeHtml(formatOperationalTimestamp(m.createdAtIso, locale))}</td>
      </tr>`
    )
    .join("");

  const attachmentRowsHtml = supportModel.attachments
    .map(
      (a) => `
      <tr>
        <td><code>${escapeHtml(a.caseId.slice(0, 8))}</code></td>
        <td><code>${escapeHtml(a.storageBucket)}/${escapeHtml(a.objectPath)}</code></td>
        <td>${escapeHtml(a.mimeType)} (${a.byteSize} B)</td>
        <td><span class="badge ${a.isInternalOnly ? "badge-warn" : "badge-ok"}">${
          a.isInternalOnly ? "INTERNAL_ONLY" : "SHARED_EVIDENCE"
        }</span></td>
        <td><code>${escapeHtml(a.sha256Hex.slice(0, 16))}...</code></td>
      </tr>`
    )
    .join("");

  const actionRowsHtml = supportModel.actionRequests
    .map(
      (ar) => `
      <tr>
        <td><code>${escapeHtml(ar.id.slice(0, 8))}</code></td>
        <td><code>${escapeHtml(ar.caseId.slice(0, 8))}</code></td>
        <td><code>${escapeHtml(ar.orderId)}</code></td>
        <td><strong>${escapeHtml(ar.actionType)}</strong></td>
        <td><strong>${escapeHtml(formatBrlCents(ar.amountCents, locale))}</strong></td>
        <td><span class="badge ${
          ar.status === "APPROVED"
            ? "badge-ok"
            : ar.status === "PENDING_FINANCE"
              ? "badge-warn"
              : "badge-err"
        }">${escapeHtml(ar.status)}</span></td>
        <td><code>${escapeHtml(ar.requestedBy.slice(0, 8))}</code></td>
        <td><code>${escapeHtml(ar.decidedBy ? ar.decidedBy.slice(0, 8) : "PENDING")}</code></td>
        <td>${escapeHtml(ar.reason)}</td>
      </tr>`
    )
    .join("");

  const mainHtml = `
    <h1>${
      isPt
        ? "Console de Suporte, SLA e Alçadas de Reembolso (M17)"
        : "Support, SLA & Refund Authority Console (M17)"
    }</h1>

    <div class="banner banner-info" role="status" data-testid="support-policy-ceiling-banner">
      ${
        isPt
          ? `Teto de aprovação automática de reembolso pelo Suporte (platform_policies): ${escapeHtml(supportModel.autoRefundLimitFormatted)} (${supportModel.autoRefundLimitCents} centavos). Valores acima exigem escalonamento para PENDING_FINANCE com MFA aal2 e Segregação de Funções.`
          : `Support automatic refund ceiling (platform_policies): ${escapeHtml(supportModel.autoRefundLimitFormatted)} (${supportModel.autoRefundLimitCents} cents). Higher amounts escalate to PENDING_FINANCE requiring Finance MFA aal2 and Segregation of Duties.`
      }
    </div>

    <div class="grid-3">
      <div class="card">
        <h3>${isPt ? "Chamados Ativos / Total" : "Total Support Cases"}</h3>
        <p class="stat-val" data-testid="support-cases-count">${supportModel.cases.length}</p>
        <small>CRITICAL_IN_ROUTE: ${supportModel.criticalInRouteCount}</small>
      </div>
      <div class="card">
        <h3>${isPt ? "Escalonados ao Financeiro" : "Pending Finance Escalations"}</h3>
        <p class="stat-val" data-testid="support-pending-finance-count">${supportModel.pendingFinanceCount}</p>
        <small>Status: PENDING_FINANCE</small>
      </div>
      <div class="card">
        <h3>${isPt ? "Alçada Financeira MFA aal2" : "Finance MFA aal2 Authority"}</h3>
        <p class="stat-val">${
          supportModel.canApproveEscalatedFinance ? "ENABLED (AAL2)" : "READ_OR_L1_ONLY"
        }</p>
        <small>Auto-Refund Ceiling: ${escapeHtml(supportModel.autoRefundLimitFormatted)}</small>
      </div>
    </div>

    <section class="card" aria-labelledby="support-cases-heading">
      <h2 id="support-cases-heading">${
        isPt ? "Fila de Chamados por SLA (Visão 360º)" : "Support Cases Queue by SLA (360º View)"
      } (${supportModel.cases.length})</h2>
      <table>
        <thead>
          <tr><th>Case</th><th>Subject / Category</th><th>Priority</th><th>Status</th><th>Requester</th><th>Order / Task</th><th>SLA Due (SP)</th></tr>
        </thead>
        <tbody>${caseRowsHtml}</tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="support-actions-heading">
      <h2 id="support-actions-heading">${
        isPt
          ? "Solicitações de Reembolso e Compensação com Alçada (support_action_requests)"
          : "Refund & Compensation Requests with Authority Matrix (support_action_requests)"
      } (${supportModel.actionRequests.length})</h2>
      <table>
        <thead>
          <tr><th>Request</th><th>Case</th><th>Order</th><th>Action Type</th><th>Amount</th><th>Status</th><th>Requested By</th><th>Decided By</th><th>Reason</th></tr>
        </thead>
        <tbody>${actionRowsHtml}</tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="support-messages-heading">
      <h2 id="support-messages-heading">${
        isPt
          ? "Mensagens e Notas Internas de Staff (support_messages)"
          : "Support Thread & Internal Staff Notes (support_messages)"
      } (${supportModel.messages.length})</h2>
      <table>
        <thead>
          <tr><th>Case</th><th>Sender</th><th>Message / Note Body</th><th>Visibility Scope</th><th>Created At (SP)</th></tr>
        </thead>
        <tbody>${messageRowsHtml}</tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="support-attachments-heading">
      <h2 id="support-attachments-heading">${
        isPt
          ? "Evidências e Anexos de Chamados (support_attachments)"
          : "Support Case Evidence & Attachments (support_attachments)"
      } (${supportModel.attachments.length})</h2>
      <table>
        <thead>
          <tr><th>Case</th><th>Bucket / Object Path</th><th>MIME / Size</th><th>Visibility</th><th>SHA-256</th></tr>
        </thead>
        <tbody>${attachmentRowsHtml}</tbody>
      </table>
    </section>
  `;

  return renderAdminRootLayout({
    title: isPt ? "Suporte e SLA (M17)" : "Support & SLA Console (M17)",
    locale,
    currentPath: "/support",
    actor,
    mainHtml,
  });
}
