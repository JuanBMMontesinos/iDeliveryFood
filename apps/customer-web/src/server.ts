import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IDeliveryApiClient } from "@ideliveryfood/api-client";
import { DEFAULT_LOCALE, resolveSupportedLocale } from "@ideliveryfood/contracts";
import {
  buildCustomerAuthSignInScreenModel,
  renderCustomerAuthSignInHtml,
} from "./app/auth/login/page.js";
import {
  buildCustomerAuthSignUpScreenModel,
  renderCustomerAuthSignUpHtml,
} from "./app/auth/signup/page.js";
import {
  buildCustomerAuthRecoverScreenModel,
  renderCustomerAuthRecoverHtml,
} from "./app/auth/recover/page.js";
import {
  loadCustomerAddressesScreen,
  renderCustomerAddressesHtml,
} from "./app/addresses/page.js";
import { renderCustomerMarketplaceHtml } from "./app/page.js";
import {
  loadCustomerStoreDetailScreen,
  renderCustomerStoreDetailHtml,
} from "./app/stores/[slug]/page.js";
import { renderCustomerCartHtml } from "./app/cart/page.js";
import { renderCustomerCheckoutHtml } from "./app/checkout/page.js";
import type { ExternalProviderDescriptor } from "@ideliveryfood/config";
import {
  loadCustomerOrderTrackingScreen,
  renderCustomerOrderTrackingHtml,
} from "./app/orders/[orderId]/page.js";
import {
  loadCustomerOrderReviewAndSupportScreen,
  renderCustomerOrderReviewAndSupportHtml,
} from "./app/orders/[orderId]/review/page.js";
import {
  loadCustomerProfileScreen,
  renderCustomerProfileHtml,
} from "./app/profile/page.js";
import {
  CustomerCartController,
  buildCustomerCheckoutScreenModel,
  loadCustomerMarketplaceScreen,
} from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../../public");

export interface CustomerWebServerDeps {
  apiClient: IDeliveryApiClient;
  supabaseUrl?: string;
  cartController?: CustomerCartController;
}

export function createCustomerWebServer(deps: CustomerWebServerDeps): http.Server {
  const supabaseUrl =
    deps.supabaseUrl ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "https://dwsoochnfxldfvcaijie.supabase.co";
  const cartController = deps.cartController ?? new CustomerCartController();

  return http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url ?? "/", "http://localhost");
    const pathname = parsedUrl.pathname;
    const locale = resolveSupportedLocale(
      parsedUrl.searchParams.get("locale") ??
        (req.headers["accept-language"] as string | undefined) ??
        DEFAULT_LOCALE
    );

    // 1. PWA Manifest & Service Worker
    if (pathname === "/manifest.webmanifest") {
      const manifestPath = path.join(PUBLIC_DIR, "manifest.webmanifest");
      const content = fs.readFileSync(manifestPath, "utf8");
      res.writeHead(200, { "Content-Type": "application/manifest+json; charset=utf-8" });
      res.end(content);
      return;
    }

    if (pathname === "/sw.js") {
      const swPath = path.join(PUBLIC_DIR, "sw.js");
      const content = fs.readFileSync(swPath, "utf8");
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Service-Worker-Allowed": "/",
      });
      res.end(content);
      return;
    }

    // 2. Route 1: / (Discovery Home)
    if (pathname === "/") {
      const search = parsedUrl.searchParams.get("search") ?? undefined;
      const cuisineCategory = parsedUrl.searchParams.get("cuisineCategory") ?? undefined;
      const model = await loadCustomerMarketplaceScreen({
        apiClient: deps.apiClient,
        locale,
        ...(search ? { search } : {}),
        ...(cuisineCategory ? { cuisineCategory } : {}),
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderCustomerMarketplaceHtml(model));
      return;
    }

    // 3. Route 2: /auth/login
    if (pathname === "/auth/login") {
      const model = buildCustomerAuthSignInScreenModel({ locale, supabaseUrl });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderCustomerAuthSignInHtml(model));
      return;
    }

    // 4. Route 3: /auth/signup
    if (pathname === "/auth/signup") {
      const model = buildCustomerAuthSignUpScreenModel({ locale, supabaseUrl });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderCustomerAuthSignUpHtml(model));
      return;
    }

    // 5. Route 4: /auth/recover
    if (pathname === "/auth/recover") {
      const model = buildCustomerAuthRecoverScreenModel({ locale, supabaseUrl });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderCustomerAuthRecoverHtml(model));
      return;
    }

    // 6. Route 5: /addresses
    if (pathname === "/addresses") {
      const targetStoreId = parsedUrl.searchParams.get("storeId") ?? undefined;
      const model = await loadCustomerAddressesScreen({
        apiClient: deps.apiClient,
        locale,
        ...(targetStoreId ? { targetStoreId } : {}),
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderCustomerAddressesHtml(model));
      return;
    }

    // 7. Route 6: /stores/[slug]
    const storeSlugMatch = pathname.match(/^\/stores\/([^/]+)$/);
    if (storeSlugMatch) {
      const slug = decodeURIComponent(storeSlugMatch[1] ?? "");
      const model = await loadCustomerStoreDetailScreen({
        apiClient: deps.apiClient,
        storeIdOrSlug: slug,
        locale,
      });
      const status = model.detail ? 200 : 404;
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderCustomerStoreDetailHtml(model));
      return;
    }

    // 8. Route 7: /cart
    if (pathname === "/cart") {
      const cartState = cartController.getState();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        renderCustomerCartHtml({
          locale,
          storeId: cartState.storeId,
          storeName: cartState.storeName,
          items: cartState.items,
        })
      );
      return;
    }

    // 8b. Route 8: /checkout
    if (pathname === "/checkout") {
      const cartState = cartController.getState();
      if (!cartState.storeId || cartState.items.length === 0) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          renderCustomerCartHtml({
            locale,
            storeId: cartState.storeId,
            storeName: cartState.storeName,
            items: cartState.items,
          })
        );
        return;
      }

      const [quoteRes, providersRes] = await Promise.all([
        deps.apiClient.createQuote({
          storeId: cartState.storeId,
          fulfillmentModality: "PLATFORM_DELIVERY",
          cartItems: [...cartState.items],
          idempotencyKey: `idem_checkout_${cartState.storeId}_${cartState.items.length}`,
        }),
        deps.apiClient.request<{ data: ExternalProviderDescriptor[] }>({
          path: "/system/providers",
          method: "GET",
        }),
      ]);

      const primaryPsp =
        providersRes.data.find((p) => p.category === "PSP" && p.isPrimary) ??
        providersRes.data.find((p) => p.category === "PSP")!;
      const checkoutModel = buildCustomerCheckoutScreenModel({
        quote: quoteRes.data,
        pspReadiness: primaryPsp,
        locale,
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderCustomerCheckoutHtml(checkoutModel, locale));
      return;
    }

    // 9. Route 9: /orders/[orderId]
    const orderTrackingMatch = pathname.match(/^\/orders\/([^/]+)$/);
    if (orderTrackingMatch) {
      const orderId = decodeURIComponent(orderTrackingMatch[1] ?? "");
      const model = await loadCustomerOrderTrackingScreen({
        apiClient: deps.apiClient,
        orderId,
        locale,
      });
      const status = model.order ? 200 : 404;
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderCustomerOrderTrackingHtml(model));
      return;
    }

    // 10. Route 10: /orders/[orderId]/review
    const orderReviewMatch = pathname.match(/^\/orders\/([^/]+)\/review$/);
    if (orderReviewMatch) {
      const orderId = decodeURIComponent(orderReviewMatch[1] ?? "");
      const model = await loadCustomerOrderReviewAndSupportScreen({
        apiClient: deps.apiClient,
        orderId,
        locale,
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderCustomerOrderReviewAndSupportHtml(model));
      return;
    }

    // 11. Route 11: /profile
    if (pathname === "/profile") {
      const model = await loadCustomerProfileScreen({
        apiClient: deps.apiClient,
        locale,
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderCustomerProfileHtml(model));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
  });
}
