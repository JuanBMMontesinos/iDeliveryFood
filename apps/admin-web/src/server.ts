import http from "node:http";
import { resolveSupportedLocale } from "@ideliveryfood/contracts";
import {
  loadAdminBackofficePageData,
  renderAdminBackofficePageHtml,
  type AdminTabKey,
} from "./app/admin/page.js";
import {
  loadFinanceBackofficePageData,
  renderFinanceBackofficePageHtml,
  type FinanceTabKey,
} from "./app/finance/page.js";
import {
  loadFleetsPortalPageData,
  renderFleetsPortalPageHtml,
} from "./app/fleets/page.js";
import {
  loadLogisticsBackofficePageData,
  renderLogisticsBackofficePageHtml,
} from "./app/logistics/page.js";

export interface AdminWebServerOptions {
  apiBaseUrl: string;
  defaultAccessToken?: string | null;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

function extractAccessToken(
  req: http.IncomingMessage,
  fallback?: string | null
): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)idelivery_access_token=([^;]+)/);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return fallback ?? null;
}

export function createAdminWebServer(
  options: AdminWebServerOptions
): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url ?? "/admin", "http://localhost");
      const pathname = parsedUrl.pathname;
      const locale = resolveSupportedLocale(
        parsedUrl.searchParams.get("locale") ??
          (req.headers["accept-language"] as string | undefined)
      );
      const accessToken = extractAccessToken(req, options.defaultAccessToken);

      if (pathname === "/health") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({ status: "ok", service: "@ideliveryfood/admin-web" })
        );
        return;
      }

      if (
        pathname === "/" ||
        pathname === "/admin" ||
        pathname === "/admin/approvals" ||
        pathname === "/admin/scopes" ||
        pathname === "/admin/audit"
      ) {
        const tab: AdminTabKey =
          pathname === "/admin/approvals"
            ? "approvals"
            : pathname === "/admin/scopes"
              ? "scopes"
              : pathname === "/admin/audit"
                ? "audit"
                : "overview";
        const data = await loadAdminBackofficePageData({
          apiBaseUrl: options.apiBaseUrl,
          accessToken,
          locale,
          tab,
          ...(options.env ? { env: options.env } : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        const html = renderAdminBackofficePageHtml(data);
        res.statusCode = data.status;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(html);
        return;
      }

      if (
        pathname === "/finance" ||
        pathname === "/finance/ledger" ||
        pathname === "/finance/reconciliation" ||
        pathname === "/finance/settlements"
      ) {
        const tab: FinanceTabKey =
          pathname === "/finance/ledger"
            ? "ledger"
            : pathname === "/finance/reconciliation"
              ? "reconciliation"
              : pathname === "/finance/settlements"
                ? "settlements"
                : "overview";
        const data = await loadFinanceBackofficePageData({
          apiBaseUrl: options.apiBaseUrl,
          accessToken,
          locale,
          tab,
          ...(options.env ? { env: options.env } : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        const html = renderFinanceBackofficePageHtml(data);
        res.statusCode = data.status;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(html);
        return;
      }

      if (pathname === "/logistics") {
        const data = await loadLogisticsBackofficePageData({
          apiBaseUrl: options.apiBaseUrl,
          accessToken,
          locale,
          ...(options.env ? { env: options.env } : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        const html = renderLogisticsBackofficePageHtml(data);
        res.statusCode = data.status;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(html);
        return;
      }

      if (pathname === "/fleets") {
        const data = await loadFleetsPortalPageData({
          apiBaseUrl: options.apiBaseUrl,
          accessToken,
          locale,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        const html = renderFleetsPortalPageHtml(data);
        res.statusCode = data.status;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(html);
        return;
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(
        err instanceof Error ? err.message : "Internal Admin Server Error"
      );
    }
  });
}
