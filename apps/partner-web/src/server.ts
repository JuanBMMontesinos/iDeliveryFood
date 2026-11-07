import http from "node:http";
import { IDeliveryApiClient } from "@ideliveryfood/api-client";
import { DEFAULT_LOCALE, resolveSupportedLocale } from "@ideliveryfood/contracts";
import {
  loadPartnerCatalogScreen,
  renderPartnerCatalogHtml,
} from "./app/catalog/page.js";
import {
  loadPartnerChainPortalScreen,
  renderPartnerChainPortalHtml,
} from "./app/chain/page.js";
import {
  loadPartnerDashboardScreen,
  renderPartnerDashboardHtml,
} from "./app/dashboard/page.js";
import {
  loadPartnerFinanceScreen,
  renderPartnerFinanceHtml,
} from "./app/finance/page.js";
import {
  loadPartnerKitchenConsoleScreen,
  renderPartnerKitchenConsoleHtml,
} from "./app/kitchen/page.js";
import {
  loadPartnerOnboardingScreen,
  renderPartnerOnboardingHtml,
} from "./app/onboarding/page.js";
import {
  loadPartnerEngagementScreen,
  renderPartnerEngagementHtml,
} from "./app/reviews/page.js";
import {
  loadPartnerStoreConfigurationScreen,
  renderPartnerStoreConfigurationHtml,
} from "./app/store/settings/page.js";
import {
  loadPartnerTeamScreen,
  renderPartnerTeamHtml,
} from "./app/team/page.js";

export interface PartnerWebServerDeps {
  apiClient: IDeliveryApiClient;
  defaultOrganizationId?: string;
  defaultStoreId?: string;
}

export function createPartnerWebServer(deps: PartnerWebServerDeps): http.Server {
  const defaultOrgId =
    deps.defaultOrganizationId ?? "00000000-0000-4000-8000-000000000101";
  const defaultStoreId =
    deps.defaultStoreId ?? "00000000-0000-4000-8000-000000000201";

  return http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url ?? "/", "http://localhost");
      const pathname = parsedUrl.pathname;
      const locale = resolveSupportedLocale(
        parsedUrl.searchParams.get("locale") ??
          (req.headers["accept-language"] as string | undefined) ??
          DEFAULT_LOCALE
      );
      const organizationId =
        parsedUrl.searchParams.get("orgId") ?? defaultOrgId;
      const storeId = parsedUrl.searchParams.get("storeId") ?? defaultStoreId;

      if (pathname === "/" || pathname === "/dashboard") {
        const model = await loadPartnerDashboardScreen({
          apiClient: deps.apiClient,
          organizationId,
          storeId,
          locale,
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPartnerDashboardHtml(model));
        return;
      }

      if (pathname === "/onboarding") {
        const kycFile = parsedUrl.searchParams.get("kycFile") ?? undefined;
        const model = await loadPartnerOnboardingScreen({
          apiClient: deps.apiClient,
          storeId,
          locale,
          ...(kycFile ? { requestKycUploadFileName: kycFile } : {}),
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPartnerOnboardingHtml(model));
        return;
      }

      if (
        pathname === "/store/settings" ||
        pathname === "/store/hours" ||
        pathname === "/store/coverage"
      ) {
        const model = await loadPartnerStoreConfigurationScreen({
          apiClient: deps.apiClient,
          storeId,
          subRoute: pathname,
          locale,
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPartnerStoreConfigurationHtml(model));
        return;
      }

      if (pathname === "/catalog") {
        const mediaFile = parsedUrl.searchParams.get("mediaFile") ?? undefined;
        const model = await loadPartnerCatalogScreen({
          apiClient: deps.apiClient,
          storeId,
          locale,
          ...(mediaFile ? { requestMediaFileName: mediaFile } : {}),
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPartnerCatalogHtml(model));
        return;
      }

      if (pathname === "/team") {
        const model = await loadPartnerTeamScreen({
          apiClient: deps.apiClient,
          organizationId,
          locale,
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPartnerTeamHtml(model));
        return;
      }

      if (pathname === "/finance") {
        const model = await loadPartnerFinanceScreen({
          apiClient: deps.apiClient,
          organizationId,
          storeId,
          locale,
        });
        const status = model.canAccessFinancialLedger ? 200 : 403;
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPartnerFinanceHtml(model));
        return;
      }

      if (
        pathname === "/reviews" ||
        pathname === "/contract" ||
        pathname === "/support"
      ) {
        const model = await loadPartnerEngagementScreen({
          apiClient: deps.apiClient,
          organizationId,
          storeId,
          subRoute: pathname,
          locale,
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPartnerEngagementHtml(model));
        return;
      }

      if (pathname === "/kitchen") {
        const audioConsent = parsedUrl.searchParams.get("audio") === "1";
        const model = await loadPartnerKitchenConsoleScreen({
          apiClient: deps.apiClient,
          organizationId,
          storeId,
          audibleAlertsConsented: audioConsent,
          locale,
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPartnerKitchenConsoleHtml(model));
        return;
      }

      if (pathname === "/chain") {
        const model = await loadPartnerChainPortalScreen({
          apiClient: deps.apiClient,
          organizationId,
          locale,
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPartnerChainPortalHtml(model));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal Server Error";
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(message);
    }
  });
}
