import {
  CURRENCY_CODE,
  DEFAULT_LOCALE,
  I18N_MESSAGES,
  OPERATIONAL_TIMEZONE,
  SUPPORTED_LOCALES,
  assertIntegerCents,
  formatBrlCents,
  formatOperationalTimestamp,
  resolveSupportedLocale,
  translateMessage,
  type I18nMessageKey,
  type SupportedLocale,
} from "@ideliveryfood/contracts";

export {
  CURRENCY_CODE,
  DEFAULT_LOCALE,
  I18N_MESSAGES,
  OPERATIONAL_TIMEZONE,
  SUPPORTED_LOCALES,
  assertIntegerCents,
  formatBrlCents,
  formatOperationalTimestamp,
  resolveSupportedLocale,
  translateMessage,
  type I18nMessageKey,
  type SupportedLocale,
};

export interface I18nCatalogParityReport {
  valid: boolean;
  totalKeys: number;
  missingInEn: string[];
  missingInPtBr: string[];
  emptyTranslations: string[];
  placeholderMismatches: string[];
}

/**
 * Verifies 100% key parity, non-empty translations, and placeholder token parity
 * (`{param}`) between English (`en` default) and Brazilian Portuguese (`pt-BR`) catalogs.
 */
export function verifyI18nCatalogParity(
  catalog: Record<"en" | "pt-BR", Record<string, string>> = I18N_MESSAGES
): I18nCatalogParityReport {
  const enObj = catalog.en ?? {};
  const ptObj = catalog["pt-BR"] ?? {};
  const allKeys = Array.from(new Set([...Object.keys(enObj), ...Object.keys(ptObj)])).sort();

  const missingInEn: string[] = [];
  const missingInPtBr: string[] = [];
  const emptyTranslations: string[] = [];
  const placeholderMismatches: string[] = [];
  const placeholderRegex = /\{[a-zA-Z0-9_]+\}/g;

  for (const key of allKeys) {
    const enVal = enObj[key];
    const ptVal = ptObj[key];

    if (enVal === undefined) {
      missingInEn.push(key);
      continue;
    }
    if (ptVal === undefined) {
      missingInPtBr.push(key);
      continue;
    }
    if (enVal.trim().length === 0) {
      emptyTranslations.push(`en:${key}`);
    }
    if (ptVal.trim().length === 0) {
      emptyTranslations.push(`pt-BR:${key}`);
    }

    const enTokens = (enVal.match(placeholderRegex) ?? []).sort();
    const ptTokens = (ptVal.match(placeholderRegex) ?? []).sort();
    if (enTokens.join(",") !== ptTokens.join(",")) {
      placeholderMismatches.push(key);
    }
  }

  const valid =
    missingInEn.length === 0 &&
    missingInPtBr.length === 0 &&
    emptyTranslations.length === 0 &&
    placeholderMismatches.length === 0;

  return {
    valid,
    totalKeys: allKeys.length,
    missingInEn,
    missingInPtBr,
    emptyTranslations,
    placeholderMismatches,
  };
}

/**
 * Parses an HTTP `Accept-Language` header with optional quality weights (`;q=0.9`)
 * and negotiates the highest-priority supported locale (`'en'` default or `'pt-BR'`).
 */
export function negotiateAcceptLanguageHeader(
  acceptLanguageHeader?: string | null
): SupportedLocale {
  if (!acceptLanguageHeader || acceptLanguageHeader.trim().length === 0) {
    return DEFAULT_LOCALE;
  }

  const candidates = acceptLanguageHeader
    .split(",")
    .map((entry, index) => {
      const parts = entry.trim().split(";");
      const tag = (parts[0] ?? "").trim();
      let q = 1.0;
      for (const p of parts.slice(1)) {
        const trimmed = p.trim();
        if (trimmed.startsWith("q=")) {
          const parsed = Number.parseFloat(trimmed.slice(2));
          if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
            q = parsed;
          } else {
            q = 0;
          }
        }
      }
      return { tag, q, index };
    })
    .filter((c) => c.tag.length > 0 && c.q > 0)
    .sort((a, b) => (b.q !== a.q ? b.q - a.q : a.index - b.index));

  for (const candidate of candidates) {
    const lower = candidate.tag.toLowerCase();
    if (lower === "pt-br" || lower === "pt_br" || lower.startsWith("pt")) {
      return "pt-BR";
    }
    if (lower === "en" || lower.startsWith("en-") || lower.startsWith("en_")) {
      return "en";
    }
  }

  return DEFAULT_LOCALE;
}

/**
 * Formats an operational SLA countdown or duration in seconds in `'en'` or `'pt-BR'`
 * without changing operational timezone or currency.
 */
export function formatOperationalDuration(
  seconds: number,
  locale: SupportedLocale = DEFAULT_LOCALE
): string {
  if (!Number.isFinite(seconds)) {
    throw new RangeError("INVALID_DURATION_SECONDS: seconds must be a finite number.");
  }
  const rounded = Math.round(seconds);
  const absSeconds = Math.abs(rounded);
  const mins = Math.floor(absSeconds / 60);
  const secs = absSeconds % 60;

  if (rounded < 0) {
    return locale === "pt-BR"
      ? `SLA estourado há ${mins}m ${secs}s`
      : `SLA breached by ${mins}m ${secs}s`;
  }
  return locale === "pt-BR"
    ? `${mins}m ${secs}s restantes`
    : `${mins}m ${secs}s remaining`;
}
