# Domain & Engineering Conventions

## 1. Identifiers & Authorization
- All primary keys use UUID v4 (`uuid` column type in PostgreSQL).
- Stable deterministic UUIDs (in the `00000000-0000-4000-8000-xxxxxxxxxxxx` namespace) are used exclusively in `supabase/seed.sql` with `is_test_data = true` so that seed execution is 100% idempotent.
- **UUIDs never replace authorization:** Every endpoint and RLS policy validates actor identity, role, and organization/unit ownership.

## 2. Money & Currency
- Currency code: `'BRL'` (ISO 4217).
- All monetary values in database columns, API payloads, and domain calculations are **signed or unsigned integer centavos** (`*_cents`, e.g., `2590` = `R$ 25,90`).
- Floating-point types (`float`, `real`, `double precision`, JS float arithmetic for money) are forbidden.
- Percentages and commission rates are stored in **basis points** (`*_bps`, where `10000` bps = `100.00%`, `1250` bps = `12.50%`).

## 3. Time & Timezones
- All timestamps in PostgreSQL use `timestamptz` stored in **UTC**.
- Store schedules (`store_hours`, `store_hour_exceptions`) explicitly store the store's IANA timezone (defaulting to `'America/Sao_Paulo'`).
- UI formatting converts UTC timestamps to the operational timezone (`America/Sao_Paulo`) and formats according to the active UI locale (`en` or `pt-BR`).

## 4. Internationalization (i18n)
- **Primary & Default Language:** English (`en`).
- **Secondary Supported Language:** Brazilian Portuguese (`pt-BR`).
- **Persistence:** Authenticated users have their `preferred_locale` (`'en' | 'pt-BR'`) persisted in `public.profiles.preferred_locale` and `public.user_preferences.locale` in Supabase.
- **Formatting:** Currency (`BRL`) and operational region (`BR` / `America/Sao_Paulo`) remain Brazilian even when the interface language is English (`en`).
- **Zero String Concatenation:** Translatable strings use parameterized keys (`{storeName}`, `{OrderId}`, plural forms) across Web (`packages/contracts/src/i18n`), Android (`strings.xml` / `plurals`), and iOS (`Localizable.xcstrings`).

## 5. Pagination & Error Envelopes
- **Pagination Request:** `cursor` (opaque base64/UUID cursor) or `page`/`pageSize` (max `100`, default `20`).
- **Pagination Response:** `{ data: T[], meta: { totalCount?: number, nextCursor: string | null, hasMore: boolean } }`.
- **Standard Error Envelope:**
  ```json
  {
    "error": {
      "code": "AUTHZ_FORBIDDEN_TENANT",
      "messageKey": "errors.authz.forbidden_tenant",
      "message": "You do not have permission to access this organization or store.",
      "correlationId": "req_01J...",
      "details": {}
    }
  }
  ```

## 6. Idempotency & State Machines
- Mutating endpoints (`POST /v1/quotes`, `POST /v1/orders`, `POST /v1/orders/{id}/commands`, `POST /v1/payments`, `POST /v1/refunds`) require an `Idempotency-Key` header (`16..128` chars).
- Order state (`order_status`), Payment state (`payment_status`), and Delivery state (`delivery_status`) are tracked as independent state machines with append-only event history (`order_events`, `delivery_events`, `payment_provider_events`).
