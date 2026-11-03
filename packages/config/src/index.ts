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
