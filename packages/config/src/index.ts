import crypto from "node:crypto";
import net from "node:net";
import type { ProviderCategory, ProviderReadinessStatus, SupportedLocale } from "@ideliveryfood/contracts";
import { CURRENCY_CODE, DEFAULT_LOCALE, OPERATIONAL_TIMEZONE, resolveSupportedLocale } from "@ideliveryfood/contracts";

export interface PublicWebEnvConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl: string;
  defaultLocale: SupportedLocale;
  operationalTimezone: typeof OPERATIONAL_TIMEZONE;
  currencyCode: typeof CURRENCY_CODE;
}

export interface ServerEnvConfig extends PublicWebEnvConfig {
  appEnv: "development" | "test" | "staging" | "production";
  apiPort: number;
  supabaseServiceRoleKey?: string | undefined;
  supabaseJwtSecret?: string | undefined;
}

const FORBIDDEN_PUBLIC_ENV_NAMES = new Set([
  "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_DATABASE_URL",
  "NEXT_PUBLIC_STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_MERCADOPAGO_ACCESS_TOKEN",
  "NEXT_PUBLIC_PAGARME_SECRET_KEY",
  "NEXT_PUBLIC_GOOGLE_MAPS_SERVER_API_KEY",
  "NEXT_PUBLIC_MAPBOX_SECRET_TOKEN",
  "NEXT_PUBLIC_RESEND_API_KEY",
  "NEXT_PUBLIC_FCM_PRIVATE_KEY",
  "NEXT_PUBLIC_APNS_PRIVATE_KEY",
]);

const SECRET_VALUE_HEURISTICS = [
  /^sk_(?:live|test)_/i,
  /^sbp_[0-9a-f]{20,}/i,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i,
  /^postgres(?:ql)?:\/\//i,
];

/**
 * Validates public client environment variables and strictly blocks any server secret
 * from leaking into NEXT_PUBLIC_* variables.
 */
export function validatePublicWebEnv(rawEnv: Record<string, string | undefined>): PublicWebEnvConfig {
  for (const [key, value] of Object.entries(rawEnv)) {
    if (!key.startsWith("NEXT_PUBLIC_")) continue;

    if (FORBIDDEN_PUBLIC_ENV_NAMES.has(key) && value && value.trim().length > 0) {
      throw new Error(
        `SECURITY_ENV_LEAK: Forbidden server secret '${key}' detected in NEXT_PUBLIC_* client bundle.`
      );
    }

    if (value) {
      for (const pattern of SECRET_VALUE_HEURISTICS) {
        if (pattern.test(value.trim())) {
          throw new Error(
            `SECURITY_ENV_LEAK: Variable '${key}' contains a value matching a server secret pattern.`
          );
        }
      }
    }
  }

  const supabaseUrl = (rawEnv.NEXT_PUBLIC_SUPABASE_URL ?? rawEnv.SUPABASE_URL ?? "").trim();
  const supabaseAnonKey = (
    rawEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    rawEnv.SUPABASE_ANON_KEY ??
    ""
  ).trim();

  if (!supabaseUrl || !supabaseUrl.startsWith("https://")) {
    throw new Error("ENV_VALIDATION_ERROR: NEXT_PUBLIC_SUPABASE_URL must be a valid https:// URL.");
  }

  if (!supabaseAnonKey || supabaseAnonKey.length < 10) {
    throw new Error("ENV_VALIDATION_ERROR: NEXT_PUBLIC_SUPABASE_ANON_KEY is required.");
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    apiBaseUrl: (rawEnv.NEXT_PUBLIC_API_BASE_URL ?? rawEnv.API_BASE_URL ?? "http://localhost:4000/v1").trim(),
    defaultLocale: resolveSupportedLocale(rawEnv.DEFAULT_LOCALE ?? DEFAULT_LOCALE),
    operationalTimezone: OPERATIONAL_TIMEZONE,
    currencyCode: CURRENCY_CODE,
  };
}

export function validateServerEnv(rawEnv: Record<string, string | undefined>): ServerEnvConfig {
  const publicConfig = validatePublicWebEnv(rawEnv);
  const rawAppEnv = (rawEnv.APP_ENV ?? rawEnv.NODE_ENV ?? "development").trim().toLowerCase();
  const appEnv =
    rawAppEnv === "production" || rawAppEnv === "staging" || rawAppEnv === "test"
      ? rawAppEnv
      : "development";

  const portNum = Number.parseInt(rawEnv.API_PORT ?? "4000", 10);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error("ENV_VALIDATION_ERROR: API_PORT must be a valid TCP port (1-65535).");
  }

  return {
    ...publicConfig,
    appEnv,
    apiPort: portNum,
    supabaseServiceRoleKey: rawEnv.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
    supabaseJwtSecret: rawEnv.SUPABASE_JWT_SECRET?.trim() || undefined,
  };
}

export interface ExternalProviderDescriptor {
  providerCode: string;
  category: ProviderCategory;
  displayName: string;
  isPrimary: boolean;
  requiredEnvVars: readonly string[];
  status: ProviderReadinessStatus;
  missingEnvVars: string[];
}

const PRECONFIGURED_PROVIDERS: ReadonlyArray<{
  providerCode: string;
  category: ProviderCategory;
  displayName: string;
  isPrimary: boolean;
  requiredEnvVars: readonly string[];
}> = [
  {
    providerCode: "stripe",
    category: "PSP",
    displayName: "Stripe Brazil (PIX & Cards)",
    isPrimary: true,
    requiredEnvVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
  },
  {
    providerCode: "mercadopago",
    category: "PSP",
    displayName: "Mercado Pago Checkout Transparente",
    isPrimary: false,
    requiredEnvVars: [
      "MERCADOPAGO_ACCESS_TOKEN",
      "MERCADOPAGO_WEBHOOK_SECRET",
      "NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY",
    ],
  },
  {
    providerCode: "pagarme",
    category: "PSP",
    displayName: "Pagar.me Stone Split V5",
    isPrimary: false,
    requiredEnvVars: ["PAGARME_SECRET_KEY", "PAGARME_WEBHOOK_SECRET", "NEXT_PUBLIC_PAGARME_PUBLIC_KEY"],
  },
  {
    providerCode: "google_maps",
    category: "MAPS",
    displayName: "Google Maps Platform (Geocoding & Routes)",
    isPrimary: true,
    requiredEnvVars: ["GOOGLE_MAPS_SERVER_API_KEY", "NEXT_PUBLIC_GOOGLE_MAPS_WEB_KEY"],
  },
  {
    providerCode: "mapbox",
    category: "MAPS",
    displayName: "Mapbox Navigation & Isochrones",
    isPrimary: false,
    requiredEnvVars: ["MAPBOX_SECRET_TOKEN", "NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN"],
  },
  {
    providerCode: "resend",
    category: "EMAIL",
    displayName: "Resend Transactional Email",
    isPrimary: true,
    requiredEnvVars: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
  },
  {
    providerCode: "fcm",
    category: "PUSH_ANDROID",
    displayName: "Firebase Cloud Messaging (Android Native)",
    isPrimary: true,
    requiredEnvVars: ["FCM_PROJECT_ID", "FCM_CLIENT_EMAIL", "FCM_PRIVATE_KEY"],
  },
  {
    providerCode: "apns",
    category: "PUSH_IOS",
    displayName: "Apple Push Notification service (iOS Native)",
    isPrimary: true,
    requiredEnvVars: ["APNS_TEAM_ID", "APNS_KEY_ID", "APNS_PRIVATE_KEY", "APNS_BUNDLE_ID"],
  },
];

/**
 * Evaluates external provider readiness honestly (never simulating success when credentials are missing).
 */
export function inspectProviderReadiness(
  rawEnv: Record<string, string | undefined> = process.env
): ExternalProviderDescriptor[] {
  return PRECONFIGURED_PROVIDERS.map((provider) => {
    const missingEnvVars = provider.requiredEnvVars.filter((varName) => {
      const val = rawEnv[varName]?.trim();
      return !val || val.startsWith("replace_with_");
    });

    const status: ProviderReadinessStatus =
      missingEnvVars.length === 0 ? "SANDBOX_READY" : "BLOCKED_MISSING_CREDENTIALS";

    return {
      ...provider,
      status,
      missingEnvVars,
    };
  });
}

const SENSITIVE_FIELD_NAMES =
  /^(?:password|secret|token|access_?token|refresh_?token|authorization|cookie|service_?role_?key|api_?key|cpf|cnpj|tax_?id|card_?number|cvv|private_?key)$/i;

/**
 * Recursively redacts sensitive credentials, tokens, and PII before writing structured logs.
 */
export function redactSensitiveData<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === "string") {
    return input.replace(
      /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
      "Bearer [REDACTED_TOKEN]"
    ) as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item)) as unknown as T;
  }

  if (typeof input === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_NAMES.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = redactSensitiveData(val);
      }
    }
    return output as T;
  }

  return input;
}

export interface StructuredLogEntry {
  level: "INFO" | "WARN" | "ERROR";
  service: string;
  correlationId: string;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export function createStructuredLogEntry(params: {
  level: "INFO" | "WARN" | "ERROR";
  service: string;
  correlationId: string;
  message: string;
  context?: Record<string, unknown>;
}): StructuredLogEntry {
  const base: StructuredLogEntry = {
    level: params.level,
    service: params.service,
    correlationId: params.correlationId,
    message: redactSensitiveData(params.message),
    timestamp: new Date().toISOString(),
  };
  if (params.context) {
    base.context = redactSensitiveData(params.context);
  }
  return base;
}

// ============================================================================
// M23: Transverse Cybersecurity — HTTP Security Headers, Strict CSP,
// Allowlist CORS, Anti-CSRF, Rate Limiting, Anti-Mass-Assignment & Anti-SSRF
// ============================================================================

export type SecuritySurface =
  | "api"
  | "customer-web"
  | "partner-web"
  | "admin-web";

/**
 * Builds mandatory HTTP security headers and strict Content-Security-Policy (without unsafe-eval)
 * for API and Web Portal surfaces (M23).
 */
export function buildHttpSecurityHeaders(params?: {
  surface?: SecuritySurface;
}): Record<string, string> {
  const surface = params?.surface ?? "api";
  const csp =
    surface === "api"
      ? "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

  const permissionsPolicy =
    surface === "customer-web"
      ? "geolocation=(self), camera=(), microphone=(), payment=(), usb=()"
      : "geolocation=(), camera=(), microphone=(), payment=(), usb=()";

  return {
    "Content-Security-Policy": csp,
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": permissionsPolicy,
    "X-DNS-Prefetch-Control": "off",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

const DEFAULT_CORS_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
  "https://app.ideliveryfood.com.br",
  "https://partner.ideliveryfood.com.br",
  "https://admin.ideliveryfood.com.br",
];

/**
 * Parses CORS_ALLOWED_ORIGINS into a normalized allowlist set, explicitly rejecting wildcard '*'.
 */
export function resolveCorsAllowedOrigins(
  rawEnv: Record<string, string | undefined> = process.env
): Set<string> {
  const configured = (rawEnv.CORS_ALLOWED_ORIGINS ?? "").trim();
  const candidates =
    configured.length > 0
      ? configured.split(",").map((s) => s.trim())
      : DEFAULT_CORS_ALLOWED_ORIGINS;

  const allowed = new Set<string>();
  for (const item of candidates) {
    if (!item || item === "*" || item.toLowerCase() === "null") continue;
    try {
      const parsed = new URL(item);
      allowed.add(parsed.origin.toLowerCase());
    } catch {
      // Ignore malformed origin entries
    }
  }
  return allowed;
}

export interface CorsEvaluationResult {
  allowed: boolean;
  isPreflight: boolean;
  reasonCode: "ALLOWED" | "CORS_ORIGIN_FORBIDDEN";
  headers: Record<string, string>;
}

/**
 * Evaluates incoming HTTP Origin header against the strict CORS allowlist (never emitting '*').
 */
export function evaluateCorsRequest(params: {
  originHeader?: string | undefined;
  method: string;
  rawEnv?: Record<string, string | undefined>;
}): CorsEvaluationResult {
  const method = params.method.toUpperCase();
  const rawOrigin = params.originHeader?.trim();
  if (!rawOrigin) {
    return {
      allowed: true,
      isPreflight: false,
      reasonCode: "ALLOWED",
      headers: { Vary: "Origin" },
    };
  }

  let normalizedOrigin = "";
  try {
    if (rawOrigin === "*" || rawOrigin.toLowerCase() === "null") {
      return {
        allowed: false,
        isPreflight: method === "OPTIONS",
        reasonCode: "CORS_ORIGIN_FORBIDDEN",
        headers: { Vary: "Origin" },
      };
    }
    normalizedOrigin = new URL(rawOrigin).origin.toLowerCase();
  } catch {
    return {
      allowed: false,
      isPreflight: method === "OPTIONS",
      reasonCode: "CORS_ORIGIN_FORBIDDEN",
      headers: { Vary: "Origin" },
    };
  }

  const allowlist = resolveCorsAllowedOrigins(params.rawEnv);
  if (!allowlist.has(normalizedOrigin)) {
    return {
      allowed: false,
      isPreflight: method === "OPTIONS",
      reasonCode: "CORS_ORIGIN_FORBIDDEN",
      headers: { Vary: "Origin" },
    };
  }

  return {
    allowed: true,
    isPreflight: method === "OPTIONS",
    reasonCode: "ALLOWED",
    headers: {
      "Access-Control-Allow-Origin": rawOrigin,
      Vary: "Origin",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, Accept-Language, X-Correlation-Id, X-Idempotency-Key, X-CSRF-Token, X-PSP-Signature, X-PSP-Timestamp",
      "Access-Control-Expose-Headers":
        "X-Correlation-Id, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining",
      "Access-Control-Max-Age": "600",
    },
  };
}

/**
 * Builds a hardened session or CSRF cookie header with SameSite=Strict/Lax, Secure, and HttpOnly.
 */
export function buildSecureSessionCookieHeader(params: {
  name: string;
  value: string;
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax";
  secure?: boolean;
}): string {
  const parts = [
    `${encodeURIComponent(params.name)}=${encodeURIComponent(params.value)}`,
    "Path=/",
    `SameSite=${params.sameSite ?? "Strict"}`,
  ];
  if (params.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(params.maxAgeSeconds))}`);
  }
  if (params.secure ?? true) {
    parts.push("Secure");
  }
  if (params.httpOnly ?? true) {
    parts.push("HttpOnly");
  }
  return parts.join("; ");
}

function parseCookieValue(
  cookieHeader: string | undefined,
  cookieName: string
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key === cookieName) {
      try {
        return decodeURIComponent(val);
      } catch {
        return val;
      }
    }
  }
  return null;
}

export interface CsrfEvaluationResult {
  allowed: boolean;
  reasonCode:
    | "SAFE_METHOD"
    | "STATELESS_AUTH"
    | "CSRF_VERIFIED"
    | "CSRF_ORIGIN_MISMATCH"
    | "CSRF_TOKEN_INVALID";
}

/**
 * Evaluates CSRF protection on state-changing HTTP requests (POST, PUT, PATCH, DELETE)
 * when authenticated via cookies/sessions: enforces Origin/Referer allowlist + X-CSRF-Token match.
 */
export function evaluateCsrfProtection(params: {
  method: string;
  cookieHeader?: string | undefined;
  authorizationHeader?: string | undefined;
  originHeader?: string | undefined;
  refererHeader?: string | undefined;
  csrfTokenHeader?: string | undefined;
  rawEnv?: Record<string, string | undefined>;
}): CsrfEvaluationResult {
  const method = params.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return { allowed: true, reasonCode: "SAFE_METHOD" };
  }

  const hasBearerAuth = Boolean(
    params.authorizationHeader &&
      params.authorizationHeader.trim().toLowerCase().startsWith("bearer ")
  );
  const hasSessionCookie = Boolean(
    parseCookieValue(params.cookieHeader, "idelivery_access_token") ||
      parseCookieValue(params.cookieHeader, "sb-access-token") ||
      parseCookieValue(params.cookieHeader, "session_id")
  );

  if (!hasSessionCookie || hasBearerAuth) {
    return { allowed: true, reasonCode: "STATELESS_AUTH" };
  }

  // Cookie-authenticated mutation: require allowed Origin or Referer
  const allowlist = resolveCorsAllowedOrigins(params.rawEnv);
  let candidateOrigin = params.originHeader?.trim() ?? "";
  if (!candidateOrigin && params.refererHeader) {
    try {
      candidateOrigin = new URL(params.refererHeader.trim()).origin;
    } catch {
      candidateOrigin = "";
    }
  }
  if (!candidateOrigin) {
    return { allowed: false, reasonCode: "CSRF_ORIGIN_MISMATCH" };
  }
  try {
    const normalized = new URL(candidateOrigin).origin.toLowerCase();
    if (!allowlist.has(normalized)) {
      return { allowed: false, reasonCode: "CSRF_ORIGIN_MISMATCH" };
    }
  } catch {
    return { allowed: false, reasonCode: "CSRF_ORIGIN_MISMATCH" };
  }

  // Double-submit anti-CSRF token check
  const cookieCsrf = parseCookieValue(
    params.cookieHeader,
    "idelivery_csrf_token"
  );
  const headerCsrf = params.csrfTokenHeader?.trim() ?? "";
  if (!cookieCsrf || !headerCsrf || cookieCsrf.length < 16) {
    return { allowed: false, reasonCode: "CSRF_TOKEN_INVALID" };
  }
  const cookieBuf = Buffer.from(cookieCsrf, "utf8");
  const headerBuf = Buffer.from(headerCsrf, "utf8");
  if (
    cookieBuf.length !== headerBuf.length ||
    !crypto.timingSafeEqual(cookieBuf, headerBuf)
  ) {
    return { allowed: false, reasonCode: "CSRF_TOKEN_INVALID" };
  }

  return { allowed: true, reasonCode: "CSRF_VERIFIED" };
}

export type RateLimitRouteBucket =
  | "OTP_VERIFY"
  | "DATA_EXPORT"
  | "AUTH"
  | "QUOTES_ORDERS"
  | "PSP_WEBHOOKS"
  | "ADMIN_GOVERNANCE"
  | "DEFAULT";

export function classifyRateLimitRouteBucket(
  method: string,
  pathname: string
): RateLimitRouteBucket {
  const m = method.toUpperCase();
  if (/^\/v1\/logistics\/tasks\/[^/]+\/complete-otp$/.test(pathname)) {
    return "OTP_VERIFY";
  }
  if (
    pathname === "/v1/analytics/export" ||
    pathname === "/v1/me/privacy-export" ||
    /^\/v1\/governance\/privacy\/requests\/[^/]+\/export$/.test(pathname)
  ) {
    return "DATA_EXPORT";
  }
  if (
    pathname.startsWith("/v1/auth/") ||
    pathname === "/v1/me/devices/revoke"
  ) {
    return "AUTH";
  }
  if (m === "POST" && (pathname === "/v1/quotes" || pathname === "/v1/orders")) {
    return "QUOTES_ORDERS";
  }
  if (pathname.startsWith("/v1/webhooks/psp/")) {
    return "PSP_WEBHOOKS";
  }
  if (
    pathname.startsWith("/v1/admin/") ||
    pathname.startsWith("/v1/governance/")
  ) {
    return "ADMIN_GOVERNANCE";
  }
  return "DEFAULT";
}

export interface RateLimitConsumeResult {
  allowed: boolean;
  bucket: RateLimitRouteBucket;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Configurable sliding-window rate limiter by IP, actorId, and sensitive route bucket (M23).
 */
export class SlidingWindowRateLimiter {
  private readonly windowMs: number;
  private readonly limitsByBucket: Record<RateLimitRouteBucket, number>;
  private readonly hitsByKey = new Map<string, number[]>();

  constructor(rawEnv: Record<string, string | undefined> = process.env) {
    const parsedWindow = Number.parseInt(
      rawEnv.RATE_LIMIT_WINDOW_MS ?? "60000",
      10
    );
    this.windowMs =
      Number.isSafeInteger(parsedWindow) && parsedWindow >= 1000
        ? parsedWindow
        : 60000;

    const globalOverride = rawEnv.RATE_LIMIT_MAX_REQUESTS
      ? Number.parseInt(rawEnv.RATE_LIMIT_MAX_REQUESTS, 10)
      : null;
    const resolveLimit = (envKey: string, fallback: number): number => {
      if (rawEnv[envKey]) {
        const parsed = Number.parseInt(rawEnv[envKey]!, 10);
        if (Number.isSafeInteger(parsed) && parsed >= 1) return parsed;
      }
      if (
        globalOverride !== null &&
        Number.isSafeInteger(globalOverride) &&
        globalOverride >= 1
      ) {
        return globalOverride;
      }
      return fallback;
    };

    this.limitsByBucket = {
      OTP_VERIFY: resolveLimit("RATE_LIMIT_OTP_MAX", 5),
      DATA_EXPORT: resolveLimit("RATE_LIMIT_EXPORT_MAX", 10),
      AUTH: resolveLimit("RATE_LIMIT_AUTH_MAX", 25),
      QUOTES_ORDERS: resolveLimit("RATE_LIMIT_ORDERS_MAX", 60),
      PSP_WEBHOOKS: resolveLimit("RATE_LIMIT_WEBHOOKS_MAX", 120),
      ADMIN_GOVERNANCE: resolveLimit("RATE_LIMIT_ADMIN_MAX", 60),
      DEFAULT: resolveLimit("RATE_LIMIT_DEFAULT_MAX", 300),
    };
  }

  public consume(params: {
    bucket: RateLimitRouteBucket;
    clientIp: string;
    actorId?: string | null;
    nowMs?: number;
  }): RateLimitConsumeResult {
    const nowMs = params.nowMs ?? Date.now();
    const limit = this.limitsByBucket[params.bucket];
    const actorPart = params.actorId ? `actor:${params.actorId}` : "anon";
    const key = `${params.bucket}:${params.clientIp}:${actorPart}`;

    const windowStart = nowMs - this.windowMs;
    const existing = (this.hitsByKey.get(key) ?? []).filter(
      (ts) => ts > windowStart
    );

    if (existing.length >= limit) {
      const oldestInWindow = existing[0] ?? nowMs;
      const retryAfterMs = Math.max(1000, oldestInWindow + this.windowMs - nowMs);
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      this.hitsByKey.set(key, existing);
      return {
        allowed: false,
        bucket: params.bucket,
        limit,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    existing.push(nowMs);
    this.hitsByKey.set(key, existing);
    return {
      allowed: true,
      bucket: params.bucket,
      limit,
      remaining: Math.max(0, limit - existing.length),
      retryAfterSeconds: 0,
    };
  }
}

const ALWAYS_FORBIDDEN_MASS_ASSIGNMENT_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "is_admin",
  "isadmin",
  "is_super_admin",
  "issuperadmin",
  "staff_scopes",
  "staffscopes",
  "organization_memberships",
  "organizationmemberships",
  "mfa_enforced",
  "mfaenforced",
  "aal",
  "is_approved",
  "isapproved",
  "approval_status",
  "approvalstatus",
  "platform_commission_cents",
  "platformcommissioncents",
  "merchant_net_cents",
  "merchantnetcents",
  "courier_earnings_cents",
  "courierearningscents",
  "ledger_balance_cents",
  "ledgerbalancecents",
]);

const ROUTE_ALLOWED_BODY_KEYS: ReadonlyArray<{
  pattern: RegExp;
  methods: ReadonlySet<string>;
  allowedKeys: ReadonlySet<string>;
}> = [
  {
    pattern: /^\/v1\/quotes$/,
    methods: new Set(["POST"]),
    allowedKeys: new Set([
      "id",
      "storeId",
      "addressId",
      "fulfillmentModality",
      "cartItems",
      "deliveryFeeCents",
      "discountCents",
      "discountFundedBy",
      "minOrderCents",
      "promotionCode",
      "customerLatitude",
      "customerLongitude",
      "distanceMeters",
      "estimatedPrepMinutes",
      "addressSnapshot",
      "expiresAtIso",
    ]),
  },
  {
    pattern: /^\/v1\/orders$/,
    methods: new Set(["POST"]),
    allowedKeys: new Set([
      "orderId",
      "quoteId",
      "customerNotes",
      "isStoreCurrentlyOpen",
      "discountFundedBy",
    ]),
  },
  {
    pattern: /^\/v1\/me\/preferences$/,
    methods: new Set(["PATCH"]),
    allowedKeys: new Set(["locale"]),
  },
  {
    pattern: /^\/v1\/logistics\/tasks\/[^/]+\/complete-otp$/,
    methods: new Set(["POST"]),
    allowedKeys: new Set(["otpCode", "confirmationCode"]),
  },
];

const QUOTE_CART_ITEM_ALLOWED_KEYS = new Set([
  "productId",
  "quantity",
  "selectedOptions",
  "notes",
  "substitutionPreference",
]);

export interface MassAssignmentValidationResult {
  valid: boolean;
  reasonCode: "VALID" | "MASS_ASSIGNMENT_FORBIDDEN";
  forbiddenField: string | null;
  message: string | null;
}

/**
 * Strictly validates incoming JSON bodies against mass-assignment of privileged or
 * server-calculated fields (role, organization_id, status, is_approved, price_cents)
 * and rejects unknown properties on critical endpoints (M23).
 */
export function validatePayloadAgainstMassAssignment(params: {
  pathname: string;
  method: string;
  body: Record<string, unknown> | null | undefined;
}): MassAssignmentValidationResult {
  const method = params.method.toUpperCase();
  if (
    !params.body ||
    typeof params.body !== "object" ||
    method === "GET" ||
    method === "HEAD" ||
    method === "OPTIONS"
  ) {
    return {
      valid: true,
      reasonCode: "VALID",
      forbiddenField: null,
      message: null,
    };
  }

  const pathname = params.pathname;
  const allowRoleField =
    pathname === "/v1/admin/staff-scopes" ||
    pathname === "/v1/onboarding/invitations" ||
    /^\/v1\/organizations\/[^/]+\/invitations$/.test(pathname);
  const allowOrganizationIdField =
    pathname.startsWith("/v1/admin/") ||
    pathname.startsWith("/v1/finance/") ||
    pathname.startsWith("/v1/commercial/") ||
    pathname.startsWith("/v1/marketing/") ||
    pathname.startsWith("/v1/governance/") ||
    pathname === "/v1/onboarding/invitations" ||
    pathname === "/v1/support/cases" ||
    /^\/v1\/orders\/[^/]+\/commands$/.test(pathname) ||
    /^\/v1\/(?:partner\/)?stores\/[^/]+\/(?:settings|bank-accounts|bank-account-change)$/.test(
      pathname
    );
  const allowStatusField =
    /^\/v1\/support\/cases\/[^/]+\/status$/.test(pathname) ||
    /^\/v1\/commercial\/leads\/[^/]+\/(?:status|proposals)$/.test(pathname) ||
    /^\/v1\/admin\/reviews\/[^/]+\/moderate$/.test(pathname);
  const allowPriceCentsField =
    /^\/v1\/partner\/(?:stores\/[^/]+\/)?(?:catalog\/)?products(?:\b|\/)/.test(
      pathname
    ) ||
    /^\/v1\/organizations\/[^/]+\/catalog-batch$/.test(pathname) ||
    pathname === "/v1/finance/reconciliation-runs";

  const checkKey = (rawKey: string): string | null => {
    const lower = rawKey.toLowerCase();
    if (ALWAYS_FORBIDDEN_MASS_ASSIGNMENT_KEYS.has(lower)) {
      return rawKey;
    }
    if (
      !allowRoleField &&
      (lower === "role" ||
        lower === "roles" ||
        lower === "actor_role" ||
        lower === "actorrole" ||
        lower === "staff_role" ||
        lower === "partner_role")
    ) {
      return rawKey;
    }
    if (
      !allowOrganizationIdField &&
      (lower === "organization_id" || lower === "organizationid")
    ) {
      return rawKey;
    }
    if (
      !allowStatusField &&
      (lower === "status" ||
        lower === "order_status" ||
        lower === "orderstatus" ||
        lower === "payment_status" ||
        lower === "paymentstatus")
    ) {
      return rawKey;
    }
    if (
      !allowPriceCentsField &&
      (lower === "price_cents" ||
        lower === "pricecents" ||
        lower === "unit_price_cents" ||
        lower === "unitpricecents" ||
        lower === "total_cents" ||
        lower === "totalcents")
    ) {
      return rawKey;
    }
    return null;
  };

  const inspectObject = (obj: Record<string, unknown>): string | null => {
    if (
      Object.prototype.hasOwnProperty.call(obj, "__proto__") ||
      Object.prototype.hasOwnProperty.call(obj, "constructor") ||
      Object.prototype.hasOwnProperty.call(obj, "prototype")
    ) {
      return "__proto__";
    }
    for (const [key, val] of Object.entries(obj)) {
      const hit = checkKey(key);
      if (hit) return hit;
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const nestedHit = inspectObject(item as Record<string, unknown>);
            if (nestedHit) return nestedHit;
          }
        }
      } else if (val && typeof val === "object") {
        const nestedHit = inspectObject(val as Record<string, unknown>);
        if (nestedHit) return nestedHit;
      }
    }
    return null;
  };

  const forbiddenHit = inspectObject(params.body);
  if (forbiddenHit) {
    return {
      valid: false,
      reasonCode: "MASS_ASSIGNMENT_FORBIDDEN",
      forbiddenField: forbiddenHit,
      message: `MASS_ASSIGNMENT_FORBIDDEN: Property '${forbiddenHit}' cannot be set or overridden by client payload on ${method} ${pathname}.`,
    };
  }

  for (const rule of ROUTE_ALLOWED_BODY_KEYS) {
    if (rule.methods.has(method) && rule.pattern.test(pathname)) {
      for (const key of Object.keys(params.body)) {
        if (!rule.allowedKeys.has(key)) {
          return {
            valid: false,
            reasonCode: "MASS_ASSIGNMENT_FORBIDDEN",
            forbiddenField: key,
            message: `MASS_ASSIGNMENT_FORBIDDEN: Unknown property '${key}' is not permitted on ${method} ${pathname}.`,
          };
        }
      }
    }
  }

  if (
    method === "POST" &&
    pathname === "/v1/quotes" &&
    Array.isArray(params.body.cartItems)
  ) {
    for (const item of params.body.cartItems) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        for (const key of Object.keys(item as Record<string, unknown>)) {
          if (!QUOTE_CART_ITEM_ALLOWED_KEYS.has(key)) {
            return {
              valid: false,
              reasonCode: "MASS_ASSIGNMENT_FORBIDDEN",
              forbiddenField: key,
              message: `MASS_ASSIGNMENT_FORBIDDEN: Unknown cartItem property '${key}' is not permitted on POST /v1/quotes.`,
            };
          }
        }
      }
    }
  }

  return {
    valid: true,
    reasonCode: "VALID",
    forbiddenField: null,
    message: null,
  };
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true;
  const octets = parts.map((p) => Number.parseInt(p, 10));
  if (
    octets.some(
      (n) => !Number.isInteger(n) || n < 0 || n > 255
    )
  ) {
    return true;
  }
  const [a, b] = octets as [number, number, number, number];
  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (Private Class A)
  if (a === 10) return true;
  // 100.64.0.0/10 (Carrier-Grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (Link-local & Cloud Metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (Private Class B: 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (Private Class C)
  if (a === 192 && b === 168) return true;
  // 224.0.0.0/4 (Multicast & Reserved)
  if (a >= 224) return true;
  return false;
}

function isPrivateOrReservedIpv6(rawHost: string): boolean {
  const cleaned = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
  if (cleaned === "::1" || cleaned === "::" || cleaned === "0:0:0:0:0:0:0:1") {
    return true;
  }
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1 or ::ffff:169.254.169.254)
  if (cleaned.startsWith("::ffff:")) {
    const tail = cleaned.slice("::ffff:".length);
    if (net.isIPv4(tail)) {
      return isPrivateOrReservedIpv4(tail);
    }
    return true;
  }
  // Unique Local (fc00::/7 -> fc* or fd*) & Link-Local (fe80::/10 -> fe8*, fe9*, fea*, feb*)
  if (
    cleaned.startsWith("fc") ||
    cleaned.startsWith("fd") ||
    cleaned.startsWith("fe8") ||
    cleaned.startsWith("fe9") ||
    cleaned.startsWith("fea") ||
    cleaned.startsWith("feb")
  ) {
    return true;
  }
  return false;
}

export interface SsrfValidationResult {
  allowed: boolean;
  normalizedUrl: string | null;
  reasonCode:
    | "ALLOWED"
    | "SSRF_INVALID_URL"
    | "SSRF_INSECURE_PROTOCOL"
    | "SSRF_EMBEDDED_CREDENTIALS_FORBIDDEN"
    | "SSRF_INTERNAL_HOST_FORBIDDEN"
    | "SSRF_PRIVATE_OR_METADATA_IP_FORBIDDEN";
  message: string;
}

/**
 * Validates external webhook target URLs against Server-Side Request Forgery (SSRF),
 * blocking non-HTTPS schemes, cloud metadata (169.254.169.254 / metadata.google.internal),
 * loopback (127.0.0.0/8, ::1, localhost), and RFC 1918 private networks (10/8, 172.16/12, 192.168/16) (M23).
 */
export function validateExternalWebhookUrlAgainstSsrf(
  rawUrl: string
): SsrfValidationResult {
  let parsed: URL;
  try {
    parsed = new URL((rawUrl ?? "").trim());
  } catch {
    return {
      allowed: false,
      normalizedUrl: null,
      reasonCode: "SSRF_INVALID_URL",
      message: "SSRF_INVALID_URL: Target URL is not a valid absolute URL.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      allowed: false,
      normalizedUrl: null,
      reasonCode: "SSRF_INSECURE_PROTOCOL",
      message:
        "SSRF_INSECURE_PROTOCOL: External webhook URLs must use https://.",
    };
  }

  if (parsed.username || parsed.password) {
    return {
      allowed: false,
      normalizedUrl: null,
      reasonCode: "SSRF_EMBEDDED_CREDENTIALS_FORBIDDEN",
      message:
        "SSRF_EMBEDDED_CREDENTIALS_FORBIDDEN: Webhook URLs must not contain embedded credentials.",
    };
  }

  const host = parsed.hostname.toLowerCase();
  const bareHost = host.replace(/^\[|\]$/g, "");

  if (
    bareHost === "localhost" ||
    bareHost.endsWith(".localhost") ||
    bareHost.endsWith(".local") ||
    bareHost.endsWith(".internal") ||
    bareHost === "metadata.google.internal" ||
    bareHost === "instance-data"
  ) {
    return {
      allowed: false,
      normalizedUrl: null,
      reasonCode: "SSRF_INTERNAL_HOST_FORBIDDEN",
      message: `SSRF_INTERNAL_HOST_FORBIDDEN: Internal hostname '${bareHost}' is forbidden.`,
    };
  }

  // Block integer/hex/octal single-segment IP encodings (e.g. https://2130706433 or https://0x7f000001)
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(bareHost)) {
    return {
      allowed: false,
      normalizedUrl: null,
      reasonCode: "SSRF_PRIVATE_OR_METADATA_IP_FORBIDDEN",
      message: `SSRF_PRIVATE_OR_METADATA_IP_FORBIDDEN: Numeric/hex IP host '${bareHost}' is forbidden.`,
    };
  }

  if (net.isIPv4(bareHost)) {
    if (isPrivateOrReservedIpv4(bareHost)) {
      return {
        allowed: false,
        normalizedUrl: null,
        reasonCode: "SSRF_PRIVATE_OR_METADATA_IP_FORBIDDEN",
        message: `SSRF_PRIVATE_OR_METADATA_IP_FORBIDDEN: Private, loopback, or cloud metadata IPv4 '${bareHost}' is forbidden.`,
      };
    }
  } else if (net.isIPv6(bareHost) || host.startsWith("[")) {
    if (isPrivateOrReservedIpv6(bareHost)) {
      return {
        allowed: false,
        normalizedUrl: null,
        reasonCode: "SSRF_PRIVATE_OR_METADATA_IP_FORBIDDEN",
        message: `SSRF_PRIVATE_OR_METADATA_IP_FORBIDDEN: Private or loopback IPv6 '${bareHost}' is forbidden.`,
      };
    }
  }

  return {
    allowed: true,
    normalizedUrl: parsed.toString(),
    reasonCode: "ALLOWED",
    message: "External HTTPS webhook URL passed SSRF validation.",
  };
}

const FORBIDDEN_EXECUTABLE_EXTENSIONS =
  /\.(?:html?|svg|xml|xhtml|js|mjs|cjs|ts|jsx|tsx|php|py|rb|sh|bash|exe|dll|bat|cmd|ps1|vbs|jar|war)(?:$|\.)/i;

const MIME_TO_EXTENSIONS: Record<string, readonly string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
};

export interface StorageUploadSecurityResult {
  valid: boolean;
  reasonCode:
    | "VALID"
    | "STORAGE_INVALID_FILENAME"
    | "STORAGE_DANGEROUS_EXTENSION"
    | "STORAGE_INVALID_MIME_TYPE"
    | "STORAGE_EXTENSION_MIME_MISMATCH"
    | "STORAGE_FILE_TOO_LARGE";
  message: string | null;
}

/**
 * Validates Supabase Storage signed upload requests against path traversal, executable/XSS
 * double extensions (.svg, .html, .js), MIME spoofing, and size limits (M23).
 */
export function validateStorageUploadSecurity(params: {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  maxSizeBytes: number;
  allowedMimeTypes: readonly string[];
}): StorageUploadSecurityResult {
  const rawName = (params.fileName ?? "").trim();
  if (
    !rawName ||
    rawName.includes("\0") ||
    rawName.includes("..") ||
    rawName.includes("/") ||
    rawName.includes("\\")
  ) {
    return {
      valid: false,
      reasonCode: "STORAGE_INVALID_FILENAME",
      message:
        "fileName must be a clean basename without path traversal or null bytes.",
    };
  }

  if (FORBIDDEN_EXECUTABLE_EXTENSIONS.test(rawName)) {
    return {
      valid: false,
      reasonCode: "STORAGE_DANGEROUS_EXTENSION",
      message: `Executable or active content extension in '${rawName}' is strictly prohibited.`,
    };
  }

  if (!params.allowedMimeTypes.includes(params.mimeType)) {
    return {
      valid: false,
      reasonCode: "STORAGE_INVALID_MIME_TYPE",
      message: `MIME type '${params.mimeType}' is not permitted for this storage bucket.`,
    };
  }

  const expectedExts = MIME_TO_EXTENSIONS[params.mimeType];
  if (expectedExts) {
    const lowerName = rawName.toLowerCase();
    const matchesExt = expectedExts.some((ext) => lowerName.endsWith(ext));
    if (!matchesExt) {
      return {
        valid: false,
        reasonCode: "STORAGE_EXTENSION_MIME_MISMATCH",
        message: `File extension of '${rawName}' does not match declared MIME type '${params.mimeType}'.`,
      };
    }
  }

  if (
    !Number.isSafeInteger(params.fileSizeBytes) ||
    params.fileSizeBytes <= 0 ||
    params.fileSizeBytes > params.maxSizeBytes
  ) {
    return {
      valid: false,
      reasonCode: "STORAGE_FILE_TOO_LARGE",
      message: `fileSizeBytes must be between 1 and ${params.maxSizeBytes} bytes.`,
    };
  }

  return {
    valid: true,
    reasonCode: "VALID",
    message: null,
  };
}

