/**
 * @ideliveryfood/contracts
 * Shared API envelopes, domain types, money/timezone helpers, and i18n catalogs (en default + pt-BR).
 */

export const SUPPORTED_LOCALES = ["en", "pt-BR"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "en";

export const OPERATIONAL_TIMEZONE = "America/Sao_Paulo" as const;
export const CURRENCY_CODE = "BRL" as const;

export type FulfillmentModality = "PLATFORM_DELIVERY" | "MERCHANT_DELIVERY" | "PICKUP";

export type PartnerRole =
  | "partner_owner"
  | "partner_manager"
  | "partner_operator"
  | "partner_catalog"
  | "partner_finance"
  | "partner_marketing"
  | "partner_support";

export type StaffRole =
  | "support_l1"
  | "support_l2"
  | "operations"
  | "finance"
  | "commercial"
  | "growth_marketing"
  | "risk_compliance"
  | "tech_admin";

export type AccountStatus =
  | "PENDING_VERIFICATION"
  | "PENDING_APPROVAL"
  | "ACTIVE"
  | "SUSPENDED"
  | "BLOCKED"
  | "DEACTIVATED"
  | "DELETED";

export type ProviderCategory =
  | "PSP"
  | "MAPS"
  | "EMAIL"
  | "PUSH_ANDROID"
  | "PUSH_IOS"
  | "SMS_OTP"
  | "KYC";

export type ProviderReadinessStatus =
  | "ACTIVE"
  | "SANDBOX_READY"
  | "BLOCKED_MISSING_CREDENTIALS"
  | "DISABLED";

export interface ApiErrorDetail {
  field?: string;
  reason: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    correlationId: string;
    timestamp: string;
    details?: ApiErrorDetail[];
  };
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface PublishedStoreContract {
  id: string;
  slug: string;
  name: string;
  descriptionEn: string;
  descriptionPtBr: string;
  localizedDescription: string;
  cuisineCategory: string;
  isPaused: boolean;
  timezone: string;
  city: string;
  stateCode: string;
  minOrderCents: number;
  prepTimeMinMinutes: number;
  prepTimeMaxMinutes: number;
  supportedModalities: FulfillmentModality[];
}

export interface UserPreferencesContract {
  userId: string;
  locale: SupportedLocale;
  pushOrderUpdates: boolean;
  pushPromotions: boolean;
  emailTransactional: boolean;
  emailMarketing: boolean;
}

export interface AuthenticatedActorProfileContract {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  preferredLocale: SupportedLocale;
  status: AccountStatus;
  mfaEnforced: boolean;
  aal: "aal1" | "aal2";
  organizationMemberships: Array<{
    organizationId: string;
    storeId: string | null;
    role: PartnerRole;
  }>;
  staffScopes: Array<{
    role: StaffRole;
    regionCode: string | null;
    maxRefundApprovalCents: number;
    requiresMfa: boolean;
  }>;
}

/**
 * Validates that a monetary value is a safe non-negative integer in BRL centavos.
 */
export function assertIntegerCents(value: number, fieldName = "amountCents"): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `INVALID_MONETARY_CENTS: '${fieldName}' must be a non-negative safe integer in BRL cents (received ${value}).`
    );
  }
  return value;
}

/**
 * Formats integer centavos into BRL currency without altering currency code when UI locale changes.
 * Example: 3890 -> "R$ 38.90" (en) or "R$ 38,90" (pt-BR), always BRL.
 */
export function formatBrlCents(cents: number, locale: SupportedLocale = DEFAULT_LOCALE): string {
  assertIntegerCents(cents, "cents");
  const majorUnits = cents / 100;
  return new Intl.NumberFormat(locale === "pt-BR" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: CURRENCY_CODE,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(majorUnits);
}

/**
 * Formats an ISO timestamp in the fixed operational timezone (America/Sao_Paulo),
 * regardless of the display language.
 */
export function formatOperationalTimestamp(
  isoDate: string | Date,
  locale: SupportedLocale = DEFAULT_LOCALE
): string {
  const dateObj = typeof isoDate === "string" ? new Date(isoDate) : isoDate;
  if (Number.isNaN(dateObj.getTime())) {
    throw new RangeError("INVALID_TIMESTAMP: Unable to format invalid date.");
  }
  return new Intl.DateTimeFormat(locale === "pt-BR" ? "pt-BR" : "en-US", {
    timeZone: OPERATIONAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(dateObj);
}

export function resolveSupportedLocale(rawLocale?: string | null): SupportedLocale {
  if (!rawLocale) return DEFAULT_LOCALE;
  const normalized = rawLocale.trim().toLowerCase();
  if (normalized === "pt-br" || normalized === "pt_br" || normalized === "pt") {
    return "pt-BR";
  }
  return "en";
}

export const I18N_MESSAGES = {
  en: {
    "app.brand.name": "iDeliveryFood",
    "app.brand.tagline": "Multi-tenant Food Delivery Marketplace",
    "app.locale.selector_label": "Language",
    "app.locale.en": "English (Default)",
    "app.locale.pt_br": "Português (Brasil)",
    "app.state.loading": "Loading live data from platform...",
    "app.state.empty": "No records found for the selected filter.",
    "app.state.error": "Unable to complete request ({code}). Correlation ID: {correlationId}",
    "app.state.offline": "You are currently offline. Reconnecting automatically...",
    "app.state.forbidden": "Access denied. Your role does not have permission for this scope.",
    "app.state.mfa_required": "Multi-factor authentication (MFA aal2) is required to perform this action.",
    "auth.sign_in.title": "Sign in to your account",
    "auth.sign_in.email_label": "Email address",
    "auth.sign_in.submit": "Continue",
    "auth.session.revoked": "Device session revoked successfully.",
    "auth.invitation.expired": "This invitation token has expired or has already been used.",
    "auth.privacy.retention_hold": "Account deletion deferred due to active order or statutory retention hold until {holdUntil}.",
    "marketplace.stores.heading": "Available Restaurants ({count})",
    "marketplace.stores.min_order": "Min. order: {amount}",
    "marketplace.stores.prep_time": "{min}-{max} min",
    "marketplace.modality.platform_delivery": "Platform Delivery",
    "marketplace.modality.merchant_delivery": "Store Delivery",
    "marketplace.modality.pickup": "Pickup at Store",
    "partner.portal.title": "Partner Portal — Store Operations & Catalog",
    "partner.finance.segregated_notice": "Financial ledger and settlements are restricted to Partner Owner and Partner Finance roles.",
    "admin.portal.title": "Admin Backoffice — Governance, RBAC & Provider Status",
    "admin.providers.blocked_badge": "BLOCKED: Missing external credentials ({vars})",
    "courier.app.title": "iDeliveryFood Courier",
    "courier.status.online": "Online — Ready for dispatch offers",
    "courier.status.offline": "Offline"
  },
  "pt-BR": {
    "app.brand.name": "iDeliveryFood",
    "app.brand.tagline": "Marketplace Multi-tenant de Delivery de Comida",
    "app.locale.selector_label": "Idioma",
    "app.locale.en": "English (Padrão)",
    "app.locale.pt_br": "Português (Brasil)",
    "app.state.loading": "Carregando dados em tempo real da plataforma...",
    "app.state.empty": "Nenhum registro encontrado para o filtro selecionado.",
    "app.state.error": "Não foi possível concluir a solicitação ({code}). ID de correlação: {correlationId}",
    "app.state.offline": "Você está sem conexão no momento. Reconectando automaticamente...",
    "app.state.forbidden": "Acesso negado. Seu papel não possui permissão para este escopo.",
    "app.state.mfa_required": "Autenticação multifator (MFA aal2) é obrigatória para executar esta ação.",
    "auth.sign_in.title": "Entre na sua conta",
    "auth.sign_in.email_label": "Endereço de e-mail",
    "auth.sign_in.submit": "Continuar",
    "auth.session.revoked": "Sessão do dispositivo revogada com sucesso.",
    "auth.invitation.expired": "Este token de convite expirou ou já foi utilizado.",
    "auth.privacy.retention_hold": "Exclusão de conta retida devido a pedido ativo ou obrigação legal até {holdUntil}.",
    "marketplace.stores.heading": "Restaurantes Disponíveis ({count})",
    "marketplace.stores.min_order": "Pedido mín.: {amount}",
    "marketplace.stores.prep_time": "{min}-{max} min",
    "marketplace.modality.platform_delivery": "Entrega Parceira da Plataforma",
    "marketplace.modality.merchant_delivery": "Entrega Própria da Loja",
    "marketplace.modality.pickup": "Retirada na Loja",
    "partner.portal.title": "Portal do Parceiro — Operação de Loja e Catálogo",
    "partner.finance.segregated_notice": "O livro-razão e os repasses financeiros são restritos aos papéis de Proprietário e Financeiro.",
    "admin.portal.title": "Backoffice Admin — Governança, RBAC e Status de Provedores",
    "admin.providers.blocked_badge": "BLOQUEADO: Credenciais externas ausentes ({vars})",
    "courier.app.title": "iDeliveryFood Entregador",
    "courier.status.online": "Online — Pronto para ofertas de entrega",
    "courier.status.offline": "Offline"
  }
} as const;

export type I18nMessageKey = keyof typeof I18N_MESSAGES.en;

/**
 * Translates an i18n message key in the requested locale (falling back to 'en')
 * and interpolates {param} placeholders.
 */
export function translateMessage(
  key: I18nMessageKey,
  locale: SupportedLocale = DEFAULT_LOCALE,
  params?: Record<string, string | number>
): string {
  const catalog = I18N_MESSAGES[locale] ?? I18N_MESSAGES[DEFAULT_LOCALE];
  const template: string = catalog[key] ?? I18N_MESSAGES[DEFAULT_LOCALE][key];
  if (!params) return template;

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, token: string) => {
    const val = params[token];
    return val !== undefined ? String(val) : `{${token}}`;
  });
}
