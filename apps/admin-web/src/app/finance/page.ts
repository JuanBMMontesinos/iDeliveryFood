import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  formatBrlCents,
  formatOperationalTimestamp,
  translateMessage,
  type AuthenticatedActorProfileContract,
  type FinanceBackofficeOverviewContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  buildFinancialBackofficeModel,
  type FinancialBackofficeScreenModel,
} from "../../index.js";
import {
  escapeHtml,
  normalizeApiBaseUrl,
  renderAdminRootLayout,
} from "../layout.js";

export type FinanceTabKey =
  | "overview"
  | "ledger"
  | "reconciliation"
  | "settlements";

export interface FinanceBackofficePageData {
  status: number;
  locale: SupportedLocale;
  tab: FinanceTabKey;
  actor: AuthenticatedActorProfileContract | null;
  financeModel: FinancialBackofficeScreenModel | null;
  overview: FinanceBackofficeOverviewContract | null;
  errorMessage: string | null;
}

export async function loadFinanceBackofficePageData(params: {
  apiBaseUrl: string;
  accessToken?: string | null;
  locale?: SupportedLocale;
  tab?: FinanceTabKey;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<FinanceBackofficePageData> {
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

    // Pre-check authorization via buildFinancialBackofficeModel
    const preCheckModel = buildFinancialBackofficeModel({
      actor,
      orders: [],
      locale,
      env: params.env ?? {},
    });

    if (!preCheckModel.authorized) {
      return {
        status: 403,
        locale,
        tab,
        actor,
        financeModel: preCheckModel,
        overview: null,
        errorMessage: preCheckModel.banner?.message ?? null,
      };
    }

    const finRes = await client.getFinanceBackofficeOverview();
    const overview = finRes.data;
    const firstSettlement = overview.settlements[0];

    const financeModel = buildFinancialBackofficeModel({
      actor,
      orders: overview.orders,
      ...(firstSettlement
        ? {
            settlementToExecute: {
              settlement: firstSettlement,
              providerCode: "stripe",
              bankAccountApprovedByActorId:
                firstSettlement.approvedBy &&
                firstSettlement.approvedBy !== actor.id
                  ? firstSettlement.approvedBy
                  : "00000000-0000-4000-8000-000000000090",
            },
          }
        : {}),
      env: params.env ?? {},
      locale,
    });

    return {
      status: 200,
      locale,
      tab,
      actor,
      financeModel,
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
      tab,
      actor: null,
      financeModel: null,
      overview: null,
      errorMessage,
    };
  }
}

export function renderFinanceBackofficePageHtml(
  data: FinanceBackofficePageData
): string {
  const { locale, tab, actor, financeModel, overview } = data;
  const currentPath =
    tab === "overview"
      ? "/finance"
      : tab === "ledger"
        ? "/finance/ledger"
        : tab === "reconciliation"
          ? "/finance/reconciliation"
          : "/finance/settlements";

  if (!financeModel || !financeModel.authorized || !overview) {
    const bannerMsg =
      financeModel?.banner?.message ??
      data.errorMessage ??
      translateMessage("app.state.forbidden", locale);
    const mainHtml = `
      <section class="card" aria-labelledby="finance-denied-heading">
        <h1 id="finance-denied-heading">Financial Backoffice &amp; Double-Entry Ledger (M13)</h1>
        <div class="banner banner-err" role="alert" data-testid="finance-access-denied-banner">
          ${escapeHtml(bannerMsg)}
        </div>
      </section>`;
    return renderAdminRootLayout({
      title: "Financial Backoffice (M13)",
      locale,
      currentPath,
      actor,
      mainHtml,
    });
  }

  const accountRowsHtml = overview.ledgerAccounts
    .map(
      (acc) => `
      <tr>
        <td><code>${escapeHtml(acc.code)}</code></td>
        <td><strong>${escapeHtml(acc.name)}</strong></td>
        <td><span class="badge badge-ok">${escapeHtml(acc.accountType)}</span></td>
        <td>${escapeHtml(formatBrlCents(acc.debitsCents, locale))}</td>
        <td>${escapeHtml(formatBrlCents(acc.creditsCents, locale))}</td>
        <td><strong>${escapeHtml(formatBrlCents(Math.abs(acc.netBalanceCents), locale))}</strong></td>
      </tr>`
    )
    .join("");

  const settlementRowsHtml = overview.settlements
    .map(
      (s) => `
      <tr>
        <td><code>${escapeHtml(s.id)}</code></td>
        <td>${escapeHtml(s.periodStart)} → ${escapeHtml(s.periodEnd)}</td>
        <td><strong>${escapeHtml(formatBrlCents(s.amountCents, locale))}</strong></td>
        <td><span class="badge ${s.status === "PAID_CONFIRMED" ? "badge-ok" : "badge-warn"}">${escapeHtml(s.status)}</span></td>
        <td><code>${escapeHtml(s.approvedBy ?? "PENDING")}</code></td>
      </tr>`
    )
    .join("");

  const reconRowsHtml = overview.reconciliationRuns
    .map(
      (r) => `
      <tr>
        <td><code>${escapeHtml(r.id)}</code></td>
        <td><code>${escapeHtml(r.providerCode)}</code></td>
        <td>${escapeHtml(r.runDate)}</td>
        <td>${r.matchedCount}</td>
        <td>${r.discrepancyCount} (${escapeHtml(formatBrlCents(r.discrepancyTotalCents, locale))})</td>
        <td><span class="badge ${r.status === "COMPLETED" ? "badge-ok" : "badge-err"}">${escapeHtml(r.status)}</span></td>
      </tr>`
    )
    .join("");

  const refundRowsHtml = overview.refunds
    .map(
      (ref) => `
      <tr>
        <td><code>${escapeHtml(ref.id)}</code></td>
        <td><code>${escapeHtml(ref.orderId)}</code></td>
        <td><strong>${escapeHtml(formatBrlCents(ref.amountCents, locale))}</strong></td>
        <td>${escapeHtml(ref.reason)}</td>
        <td><span class="badge badge-ok">${escapeHtml(ref.status)}</span></td>
        <td>${escapeHtml(formatOperationalTimestamp(ref.createdAtIso, locale))}</td>
      </tr>`
    )
    .join("");

  const mainHtml = `
    <h1>Financial Backoffice, Double-Entry Ledger &amp; Settlements (M13)</h1>

    <div class="banner banner-info" data-testid="gmv-vs-revenue-banner">
      ${escapeHtml(financeModel.gmvVsRevenueNoticeText)}
    </div>

    ${
      financeModel.settlementNoticeText
        ? `<div class="banner banner-warn" role="status" data-testid="settlement-blocked-psp-banner">
             ${escapeHtml(financeModel.settlementNoticeText)}
           </div>`
        : ""
    }

    <div class="grid">
      <article class="card">
        <h3>Gross Merchandise Value (GMV)</h3>
        <p style="font-size:1.4rem;font-weight:700;" data-testid="finance-gmv-value">${escapeHtml(formatBrlCents(overview.gmvCents, locale))}</p>
      </article>
      <article class="card">
        <h3>Net Platform Revenue</h3>
        <p style="font-size:1.4rem;font-weight:700;" data-testid="finance-net-revenue-value">${escapeHtml(formatBrlCents(overview.netPlatformRevenueCents, locale))}</p>
      </article>
      <article class="card">
        <h3>Merchant Payables (Liability)</h3>
        <p style="font-size:1.4rem;font-weight:700;">${escapeHtml(formatBrlCents(overview.merchantPayablesCents, locale))}</p>
      </article>
      <article class="card">
        <h3>Courier Payables (Liability)</h3>
        <p style="font-size:1.4rem;font-weight:700;">${escapeHtml(formatBrlCents(overview.courierPayablesCents, locale))}</p>
      </article>
    </div>

    <section class="card" aria-labelledby="ledger-heading">
      <h2 id="ledger-heading">Double-Entry General Ledger Accounts</h2>
      <p data-testid="ledger-balance-proof">
        Total Debits: <strong>${escapeHtml(formatBrlCents(overview.totalDebitsCents, locale))}</strong> (${overview.totalDebitsCents} cents) |
        Total Credits: <strong>${escapeHtml(formatBrlCents(overview.totalCreditsCents, locale))}</strong> (${overview.totalCreditsCents} cents) |
        <span class="badge ${overview.isLedgerBalanced ? "badge-ok" : "badge-err"}">${overview.isLedgerBalanced ? "BALANCED (DEBITS === CREDITS)" : "IMBALANCED"}</span>
      </p>
      <table>
        <thead>
          <tr><th>Account Code</th><th>Account Name</th><th>Type</th><th>Debits</th><th>Credits</th><th>Net Balance</th></tr>
        </thead>
        <tbody>${accountRowsHtml}</tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="settlements-heading">
      <h2 id="settlements-heading">Merchant &amp; Courier Settlements (${overview.settlements.length})</h2>
      <table>
        <thead>
          <tr><th>Settlement ID</th><th>Period</th><th>Amount</th><th>Status</th><th>Approved By</th></tr>
        </thead>
        <tbody>${settlementRowsHtml}</tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="recon-heading">
      <h2 id="recon-heading">PSP Reconciliation Runs (${overview.reconciliationRuns.length})</h2>
      <table>
        <thead>
          <tr><th>Run ID</th><th>Provider</th><th>Run Date</th><th>Matched</th><th>Discrepancies</th><th>Status</th></tr>
        </thead>
        <tbody>${reconRowsHtml}</tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="refunds-heading">
      <h2 id="refunds-heading">Audited Order Refunds (${overview.refunds.length})</h2>
      <table>
        <thead>
          <tr><th>Refund ID</th><th>Order ID</th><th>Amount</th><th>Reason</th><th>Status</th><th>Timestamp (SP)</th></tr>
        </thead>
        <tbody>${refundRowsHtml}</tbody>
      </table>
    </section>
  `;

  return renderAdminRootLayout({
    title: "Financial Backoffice (M13)",
    locale,
    currentPath,
    actor,
    mainHtml,
  });
}
