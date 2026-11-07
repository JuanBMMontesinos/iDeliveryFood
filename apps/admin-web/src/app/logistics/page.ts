import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  formatBrlCents,
  formatOperationalTimestamp,
  translateMessage,
  type AuthenticatedActorProfileContract,
  type LogisticsBackofficeOverviewContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  buildLogisticsDispatchConsoleModel,
  type LogisticsDispatchConsoleModel,
} from "../../index.js";
import {
  escapeHtml,
  normalizeApiBaseUrl,
  renderAdminRootLayout,
} from "../layout.js";

export interface LogisticsBackofficePageData {
  status: number;
  locale: SupportedLocale;
  actor: AuthenticatedActorProfileContract | null;
  logisticsModel: LogisticsDispatchConsoleModel | null;
  overview: LogisticsBackofficeOverviewContract | null;
  errorMessage: string | null;
}

export async function loadLogisticsBackofficePageData(params: {
  apiBaseUrl: string;
  accessToken?: string | null;
  locale?: SupportedLocale;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<LogisticsBackofficePageData> {
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

    const preCheck = buildLogisticsDispatchConsoleModel({
      actor,
      tasks: [],
      env: params.env ?? {},
      locale,
    });

    if (!preCheck.authorized) {
      const mfaRequired = actor.aal !== "aal2";
      return {
        status: 403,
        locale,
        actor,
        logisticsModel: preCheck,
        overview: null,
        errorMessage: translateMessage(
          mfaRequired ? "app.state.mfa_required" : "app.state.forbidden",
          locale
        ),
      };
    }

    const logRes = await client.getLogisticsBackofficeOverview();
    const overview = logRes.data;
    const logisticsModel = buildLogisticsDispatchConsoleModel({
      actor,
      tasks: overview.tasks,
      env: params.env ?? {},
      locale,
    });

    return {
      status: 200,
      locale,
      actor,
      logisticsModel,
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
      logisticsModel: null,
      overview: null,
      errorMessage,
    };
  }
}

export function renderLogisticsBackofficePageHtml(
  data: LogisticsBackofficePageData
): string {
  const { locale, actor, logisticsModel, overview } = data;

  if (!logisticsModel || !logisticsModel.authorized || !overview) {
    const bannerMsg =
      data.errorMessage ?? translateMessage("app.state.forbidden", locale);
    const mainHtml = `
      <section class="card" aria-labelledby="logistics-denied-heading">
        <h1 id="logistics-denied-heading">Logistics &amp; Dispatch Operational Console (M14)</h1>
        <div class="banner banner-err" role="alert" data-testid="logistics-access-denied-banner">
          ${escapeHtml(bannerMsg)}
        </div>
      </section>`;
    return renderAdminRootLayout({
      title: "Logistics & Dispatch Console (M14)",
      locale,
      currentPath: "/logistics",
      actor,
      mainHtml,
    });
  }

  const taskRowsHtml = overview.tasks
    .map(
      (t) => `
      <tr>
        <td><code>${escapeHtml(t.id)}</code></td>
        <td><code>${escapeHtml(t.orderId)}</code></td>
        <td><span class="badge badge-ok">${escapeHtml(t.status)}</span></td>
        <td>${escapeHtml(t.dropoffNeighborhoodOnly)}</td>
        <td>${t.distanceMeters}m (${t.estimatedEtaMinutes} min)</td>
        <td><strong>${escapeHtml(formatBrlCents(t.courierFeeCents, locale))}</strong></td>
        <td><code>${escapeHtml(t.activeCourierId ?? "UNASSIGNED")}</code></td>
      </tr>`
    )
    .join("");

  const offerRowsHtml = overview.offers
    .map(
      (o) => `
      <tr>
        <td><code>${escapeHtml(o.id)}</code></td>
        <td>${escapeHtml(o.pickupStoreName)}</td>
        <td><strong>${escapeHtml(o.dropoffNeighborhoodOnly)}</strong> <small>(Pre-acceptance privacy)</small></td>
        <td>${escapeHtml(formatBrlCents(o.offeredFeeCents, locale))}</td>
        <td><span class="badge ${o.status === "ACCEPTED" ? "badge-ok" : "badge-warn"}">${escapeHtml(o.status)}</span></td>
        <td><code>${escapeHtml(o.courierId)}</code></td>
      </tr>`
    )
    .join("");

  const sampleRowsHtml = overview.locationSamples
    .map(
      (s) => `
      <tr>
        <td><code>${escapeHtml(s.courierId)}</code></td>
        <td>${s.latitude.toFixed(6)}, ${s.longitude.toFixed(6)}</td>
        <td>${s.accuracyMeters}m</td>
        <td><span class="badge ${s.isStaleOrLowAccuracy ? "badge-warn" : "badge-ok"}">${s.isStaleOrLowAccuracy ? "LOW_ACCURACY" : "HIGH_ACCURACY"}</span></td>
        <td>${escapeHtml(formatOperationalTimestamp(s.recordedAtIso, locale))}</td>
      </tr>`
    )
    .join("");

  const courierRowsHtml = overview.onlineCouriers
    .map(
      (c) => `
      <tr>
        <td><strong>${escapeHtml(c.fullName)}</strong><br/><small><code>${escapeHtml(c.id)}</code></small></td>
        <td>${escapeHtml(c.vehicleType)}</td>
        <td>${escapeHtml(c.activeRegionCode)}</td>
        <td><span class="badge ${c.isOnline ? "badge-ok" : "badge-warn"}">${c.isOnline ? "ONLINE" : "OFFLINE"}</span></td>
      </tr>`
    )
    .join("");

  const mainHtml = `
    <h1>Logistics &amp; Dispatch Operational Console (M14)</h1>

    ${
      logisticsModel.mapsFallbackNoticeText
        ? `<div class="banner banner-warn" role="status" data-testid="logistics-maps-fallback-banner">
             ${escapeHtml(logisticsModel.mapsFallbackNoticeText)}
           </div>`
        : ""
    }

    <div class="banner banner-info" data-testid="courier-address-privacy-banner">
      ${escapeHtml(translateMessage("courier.offer.address_privacy_notice", locale))}
    </div>

    <section class="card" aria-labelledby="tasks-heading">
      <h2 id="tasks-heading">Active &amp; Recent Delivery Tasks (${overview.tasks.length})</h2>
      <table>
        <thead>
          <tr><th>Task ID</th><th>Order ID</th><th>Status</th><th>Dropoff Neighborhood</th><th>Distance / ETA</th><th>Courier Fee</th><th>Assigned Courier</th></tr>
        </thead>
        <tbody>${taskRowsHtml}</tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="offers-heading">
      <h2 id="offers-heading">Dispatch Offers Queue (${overview.offers.length})</h2>
      <table>
        <thead>
          <tr><th>Offer ID</th><th>Pickup Store</th><th>Dropoff Neighborhood</th><th>Offered Fee</th><th>Status</th><th>Courier ID</th></tr>
        </thead>
        <tbody>${offerRowsHtml}</tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="samples-heading">
      <h2 id="samples-heading">Live Courier GPS Telemetry Samples (${overview.locationSamples.length})</h2>
      <table>
        <thead>
          <tr><th>Courier ID</th><th>Coordinates</th><th>Accuracy</th><th>Quality</th><th>Recorded At (SP)</th></tr>
        </thead>
        <tbody>${sampleRowsHtml}</tbody>
      </table>
    </section>

    <section class="card" aria-labelledby="couriers-heading">
      <h2 id="couriers-heading">Courier Fleet Roster (${overview.onlineCouriers.length})</h2>
      <table>
        <thead>
          <tr><th>Courier</th><th>Vehicle</th><th>Region</th><th>Status</th></tr>
        </thead>
        <tbody>${courierRowsHtml}</tbody>
      </table>
    </section>
  `;

  return renderAdminRootLayout({
    title: "Logistics & Dispatch Console (M14)",
    locale,
    currentPath: "/logistics",
    actor,
    mainHtml,
  });
}
