import { IDeliveryApiClient, IDeliveryApiError } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  formatBrlCents,
  formatOperationalTimestamp,
  translateMessage,
  type OrderEventRecordContract,
  type OrderRecordContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { buildUiScreenStateBanner, type UiScreenStateBanner } from "@ideliveryfood/ui-web";
import { escapeHtml, renderCustomerAppShellHtml } from "../../layout.js";

export interface CustomerOrderTrackingScreenModel {
  title: string;
  locale: SupportedLocale;
  banner: UiScreenStateBanner | null;
  order: OrderRecordContract | null;
  events: OrderEventRecordContract[];
  totalFormatted: string;
  statusLabel: string;
  otpSecurityNotice: string;
  canSelfCancel: boolean;
  cancelWindowNotice: string | null;
}

export async function loadCustomerOrderTrackingScreen(params: {
  apiClient: IDeliveryApiClient;
  orderId: string;
  locale?: SupportedLocale;
  freeCancelWindowSeconds?: number;
  now?: Date;
  isOffline?: boolean;
}): Promise<CustomerOrderTrackingScreenModel> {
  const locale = params.locale ?? params.apiClient.getLocale() ?? DEFAULT_LOCALE;
  params.apiClient.setLocale(locale);
  const freeCancelWindowSeconds = params.freeCancelWindowSeconds ?? 120;
  const now = params.now ?? new Date();

  if (params.isOffline) {
    return {
      title: translateMessage("customer.order_tracking.title", locale, { orderNumber: params.orderId }),
      locale,
      banner: buildUiScreenStateBanner({ kind: "offline", locale }),
      order: null,
      events: [],
      totalFormatted: formatBrlCents(0, locale),
      statusLabel: translateMessage("app.state.offline", locale),
      otpSecurityNotice: translateMessage("customer.order_tracking.otp_notice", locale),
      canSelfCancel: false,
      cancelWindowNotice: null,
    };
  }

  try {
    const [orderRes, eventsRes] = await Promise.all([
      params.apiClient.getOrder(params.orderId),
      params.apiClient.listOrderEvents(params.orderId),
    ]);
    const order = orderRes.data;
    const events = eventsRes.data;

    const elapsedSeconds = Math.floor(
      (now.getTime() - new Date(order.createdAtIso).getTime()) / 1000
    );
    const canSelfCancel =
      (order.orderStatus === "CREATED" ||
        order.orderStatus === "PENDING_MERCHANT_ACCEPTANCE" ||
        order.orderStatus === "ACCEPTED") &&
      elapsedSeconds <= freeCancelWindowSeconds;

    const cancelWindowNotice = !canSelfCancel
      ? translateMessage("order.cancel.window_expired", locale, {
          seconds: freeCancelWindowSeconds,
        })
      : null;

    let statusLabel = order.orderStatus;
    if (order.orderStatus === "CREATED") {
      statusLabel = translateMessage("order.status.created", locale);
    } else if (order.orderStatus === "PREPARING") {
      statusLabel = translateMessage("order.status.preparing", locale);
    } else if (order.orderStatus === "READY_FOR_PICKUP") {
      statusLabel = translateMessage("order.status.ready_for_pickup", locale);
    } else if (order.orderStatus === "DELIVERED") {
      statusLabel = translateMessage("order.status.delivered", locale);
    } else if (order.orderStatus === "CANCELLED") {
      statusLabel = translateMessage("order.status.cancelled", locale, {
        reason: order.cancellationReason ?? "N/A",
      });
    }

    return {
      title: translateMessage("customer.order_tracking.title", locale, {
        orderNumber: order.orderNumber,
      }),
      locale,
      banner: null,
      order,
      events,
      totalFormatted: formatBrlCents(order.totalCents, locale),
      statusLabel,
      otpSecurityNotice: translateMessage("customer.order_tracking.otp_notice", locale),
      canSelfCancel,
      cancelWindowNotice,
    };
  } catch (err) {
    const errorCode = err instanceof IDeliveryApiError ? err.envelope.error.code : "NETWORK_ERROR";
    const correlationId = err instanceof IDeliveryApiError ? err.envelope.error.correlationId : "N/A";
    const bannerKind =
      err instanceof IDeliveryApiError && err.status === 403 ? "forbidden" : "error";
    return {
      title: translateMessage("customer.order_tracking.title", locale, { orderNumber: params.orderId }),
      locale,
      banner: buildUiScreenStateBanner({ kind: bannerKind, locale, errorCode, correlationId }),
      order: null,
      events: [],
      totalFormatted: formatBrlCents(0, locale),
      statusLabel: errorCode,
      otpSecurityNotice: translateMessage("customer.order_tracking.otp_notice", locale),
      canSelfCancel: false,
      cancelWindowNotice: null,
    };
  }
}

export function renderCustomerOrderTrackingHtml(
  model: CustomerOrderTrackingScreenModel
): string {
  const isPt = model.locale === "pt-BR";
  if (!model.order) {
    return renderCustomerAppShellHtml({
      locale: model.locale,
      pageTitle: model.title,
      activePath: "/orders",
      banner: model.banner,
      mainContentHtml: `<section class="card"><h1>${escapeHtml(model.title)}</h1></section>`,
    });
  }

  const timelineHtml = model.events
    .map(
      (evt) => `
      <li>
        <strong>${escapeHtml(evt.eventType)}</strong> (${escapeHtml(evt.newOrderStatus)}) —
        <time datetime="${escapeHtml(evt.createdAtIso)}">${escapeHtml(formatOperationalTimestamp(evt.createdAtIso, model.locale))}</time>
      </li>`
    )
    .join("");

  const mainContentHtml = `
    <section class="card" aria-labelledby="order-tracking-heading">
      <h1 id="order-tracking-heading">${escapeHtml(model.title)}</h1>
      <p role="status" aria-live="polite">
        <span class="badge">${escapeHtml(model.statusLabel)}</span>
        <span class="badge">Payment: ${escapeHtml(model.order.paymentStatus)}</span>
        <span class="badge">Delivery: ${escapeHtml(model.order.deliveryStatus)}</span>
      </p>
      <p><strong>Total:</strong> ${escapeHtml(model.totalFormatted)}</p>
      <div class="card" role="note">
        <strong>OTP:</strong> ${escapeHtml(model.otpSecurityNotice)}
      </div>
      <h2>${isPt ? "Linha do Tempo Auditada" : "Audited Timeline"}</h2>
      <ol>${timelineHtml}</ol>
      ${
        model.canSelfCancel
          ? `<button type="button">${isPt ? "Cancelar Pedido" : "Cancel Order"}</button>`
          : `<p><small>${escapeHtml(model.cancelWindowNotice ?? "")}</small></p>`
      }
      <p style="margin-top:1rem;">
        <a href="/orders/${escapeHtml(model.order.id)}/review?locale=${escapeHtml(model.locale)}" class="nav-link">
          ${escapeHtml(translateMessage("customer.review.title", model.locale))}
        </a>
      </p>
    </section>
  `;

  return renderCustomerAppShellHtml({
    locale: model.locale,
    pageTitle: model.title,
    activePath: `/orders/${model.order.id}`,
    banner: model.banner,
    mainContentHtml,
  });
}
