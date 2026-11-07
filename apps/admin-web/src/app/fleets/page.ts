import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  type AuthenticatedActorProfileContract,
  type FleetsBackofficeOverviewContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { buildFleetOperatorPortalModel } from "../../index.js";
import {
  escapeHtml,
  normalizeApiBaseUrl,
  renderAdminRootLayout,
} from "../layout.js";

export interface FleetsPortalPageData {
  status: number;
  locale: SupportedLocale;
  actor: AuthenticatedActorProfileContract | null;
  overview: FleetsBackofficeOverviewContract | null;
  portalStatus:
    | "ACTIVE"
    | "DISABLED_PENDING_FLEET_CONTRACT"
    | "DENIED_CROSS_FLEET_OR_INDEPENDENT_COURIER";
  visibleCouriers: ReadonlyArray<{
    courierId: string;
    courierName: string;
    fleetOrganizationId: string | null;
  }>;
  errorMessage: string | null;
}

export async function loadFleetsPortalPageData(params: {
  apiBaseUrl: string;
  accessToken?: string | null;
  locale?: SupportedLocale;
  fleetOrganizationId?: string;
  fetchImpl?: typeof fetch;
}): Promise<FleetsPortalPageData> {
  const locale = params.locale ?? DEFAULT_LOCALE;
  const client = new IDeliveryApiClient({
    baseUrl: normalizeApiBaseUrl(params.apiBaseUrl),
    locale,
    getAccessToken: () => params.accessToken ?? null,
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
  });

  try {
    const [meRes, fleetsRes] = await Promise.all([
      client.getMe(),
      client.getFleetsBackofficeOverview(),
    ]);

    const actor = meRes.data;
    const overview = fleetsRes.data;
    const fleetOrgId =
      params.fleetOrganizationId ??
      actor.organizationMemberships[0]?.organizationId ??
      "00000000-0000-4000-8000-000000000101";

    const fleetModel = buildFleetOperatorPortalModel({
      fleetOrganizationId: fleetOrgId,
      actorOrganizationIds: actor.organizationMemberships.map(
        (m) => m.organizationId
      ),
      isFleetContractApproved: overview.featureFleetOperatorsEnabled,
      couriers: overview.couriers,
    });

    return {
      status: 200,
      locale,
      actor,
      overview,
      portalStatus: fleetModel.portalStatus,
      visibleCouriers: fleetModel.visibleCouriers,
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
      overview: null,
      portalStatus: "DISABLED_PENDING_FLEET_CONTRACT",
      visibleCouriers: [],
      errorMessage,
    };
  }
}

export function renderFleetsPortalPageHtml(data: FleetsPortalPageData): string {
  const { locale, actor, overview, portalStatus, visibleCouriers } = data;

  const courierRowsHtml = visibleCouriers
    .map(
      (c) => `
      <tr>
        <td><code>${escapeHtml(c.courierId)}</code></td>
        <td><strong>${escapeHtml(c.courierName)}</strong></td>
        <td><code>${escapeHtml(c.fleetOrganizationId ?? "INDEPENDENT")}</code></td>
      </tr>`
    )
    .join("");

  const mainHtml = `
    <h1>Fleet &amp; Logistics Operator Portal (M15)</h1>

    <section class="card" aria-labelledby="fleet-policy-heading">
      <h2 id="fleet-policy-heading">Platform Policy &amp; Contract Governance</h2>
      <p>
        Policy Key: <code>${escapeHtml(overview?.policyKey ?? "DEFAULT_BR_MARKETPLACE")}</code> |
        <code>feature_fleet_operators_enabled</code>:
        <span class="badge ${overview?.featureFleetOperatorsEnabled ? "badge-ok" : "badge-warn"}" data-testid="fleet-feature-flag-badge">
          ${overview?.featureFleetOperatorsEnabled ? "TRUE (ENABLED)" : "FALSE (DISABLED BY DEFAULT POLICY)"}
        </span>
      </p>
      <div class="banner ${portalStatus === "ACTIVE" ? "banner-info" : "banner-warn"}" data-testid="fleet-portal-status-banner">
        Portal Status: <strong>${escapeHtml(portalStatus)}</strong> —
        ${
          portalStatus === "DISABLED_PENDING_FLEET_CONTRACT"
            ? "External Fleet Operator Portal is disabled in platform_policies until an approved Fleet Operator contract is enabled. Independent couriers are strictly isolated."
            : portalStatus === "DENIED_CROSS_FLEET_OR_INDEPENDENT_COURIER"
              ? "Cross-fleet or independent courier access is strictly denied."
              : "Fleet Operator Portal active for contracted fleet organization."
        }
      </div>
    </section>

    <section class="card" aria-labelledby="fleet-couriers-heading">
      <h2 id="fleet-couriers-heading">Contracted Fleet Couriers (${visibleCouriers.length})</h2>
      <table>
        <thead>
          <tr><th>Courier ID</th><th>Name</th><th>Fleet Organization</th></tr>
        </thead>
        <tbody>${courierRowsHtml}</tbody>
      </table>
    </section>
  `;

  return renderAdminRootLayout({
    title: "Fleet Operator Portal (M15)",
    locale,
    currentPath: "/fleets",
    actor,
    mainHtml,
  });
}
