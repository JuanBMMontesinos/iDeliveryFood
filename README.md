# iDeliveryFood — Multi-Tenant Food Delivery Marketplace

Enterprise monorepo for **iDeliveryFood**, a multi-tenant food delivery marketplace built on **Supabase (PostgreSQL 17 + Auth + RLS + Storage + Realtime)**, **TypeScript/Node.js (`/v1` API, Worker, Web Portals)**, **Kotlin/Jetpack Compose (Android Native)**, and **Swift/SwiftUI (iOS Native)**.

---

## 1. Architecture & Core Invariants

- **Default Language (`i18n`):** English (`en`) by default across all web, mobile, and API surfaces, switchable at any time to Brazilian Portuguese (`pt-BR`) with user preference persisted in Supabase (`public.profiles.preferred_locale` and `public.user_preferences.locale`).
- **Fixed Monetary & Temporal Standards:**
  - **Currency:** `BRL` stored and calculated exclusively in integer centavos (`*_cents`). Switching UI language between `en` and `pt-BR` never changes the currency or prices.
  - **Timezone:** `UTC` in database/API (`timestamptz`), rendered in `America/Sao_Paulo`.
- **Defense-in-Depth Multi-Tenant Security:**
  - 100% of `public` tables (46 tables) enforce PostgreSQL Row Level Security (RLS).
  - Partner roles (`partner_owner`, `partner_manager`, `partner_operator`, `partner_catalog`, `partner_finance`, `partner_marketing`, `partner_support`) are strictly isolated by `organization_id` and `store_id`.
  - Internal platform staff roles (`support_l1`, `support_l2`, `operations`, `finance`, `commercial`, `growth_marketing`, `risk_compliance`, `tech_admin`) require verified MFA (`aal2`) for sensitive actions.
- **Double-Entry Financial Ledger:**
  - `public.ledger_journals` and `public.ledger_entries` enforce balanced debits and credits (`SUM(DEBIT) = SUM(CREDIT)`) via a deferred PostgreSQL constraint trigger (`trg_verify_journal_balanced`).

---

## 2. Repository Structure

```text
.
├── apps/
│   ├── api/                # Versioned /v1 HTTP API server
│   ├── worker/             # Transactional outbox worker with exponential backoff
│   ├── customer-web/       # Consumer marketplace discovery & account portal
│   ├── partner-web/        # Merchant store operations, catalog & finance portal
│   ├── admin-web/          # Internal governance, RBAC/MFA & provider status portal
│   ├── customer-android/   # Native Android Consumer App (Kotlin + Jetpack Compose)
│   ├── courier-android/    # Native Android Courier App (Kotlin + Jetpack Compose)
│   ├── customer-ios/       # Native iOS Consumer App (Swift + SwiftUI)
│   └── courier-ios/        # Native iOS Courier App (Swift + SwiftUI)
├── packages/
│   ├── contracts/          # OpenAPI 3.1 (/v1), DTOs, BRL centavos & i18n catalogs (en + pt-BR)
│   ├── config/             # Env schema validation, provider readiness & redacted logger
│   ├── domain/             # Order/Payment/Delivery state machines, quote math & LGPD retention
│   ├── authz/              # RBAC/ABAC engine, MFA aal2 verifier & SHA-256 invitations
│   ├── api-client/         # Typed /v1 client with Correlation-ID & Idempotency-Key support
│   └── ui-web/             # Accessible UI screen states & language selector view-models
├── supabase/
│   ├── config.toml         # Supabase project configuration
│   ├── migrations/         # Versioned SQL migrations applied to dwsoochnfxldfvcaijie
│   ├── seed.sql            # Idempotent synthetic development/test seed (is_test_data = true)
│   └── tests/              # Automated SQL RLS, multi-tenant & constraint verification suite
├── scripts/
│   ├── db-reset-local.mjs        # Local-only database reset guard (blocks remote hosts)
│   ├── bootstrap-first-admin.mjs # Controlled local bootstrap for initial tech_admin
│   └── secret-scan.mjs           # Automated repository secret & .env leakage scanner
└── docs/
    ├── PRD.md
    ├── DELIVERY_STATUS.md
    ├── architecture/       # ADR-001, ADR-002, ADR-003, conventions.md
    ├── database/           # ERD.md, DATA_DICTIONARY.md, RLS_MATRIX.md
    └── modules/            # M00.md, M01.md, M02.md, M03.md
```

---

## 3. Verification & Development Commands

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Scan repository for secret leakage or forbidden .env files
pnpm security:scan

# 3. Typecheck and lint all packages and applications
pnpm lint
pnpm typecheck

# 4. Run all unit, contract, i18n parity, AuthZ/MFA, and /v1 API integration tests
pnpm test

# 5. Build all workspace packages and applications
pnpm build
```

See [docs/DELIVERY_STATUS.md](file:///d:/IAProjects/iDeliveryFood/docs/DELIVERY_STATUS.md) for the complete status report of Phase A (`M00 -> M01 -> M02 -> M03`) and honest readiness reporting of external providers.
