# iDeliveryFood — Multi-Tenant Food & Grocery Delivery Marketplace Platform (`M00`–`M26`)

Enterprise monorepo for **iDeliveryFood**, a production-grade, multi-tenant food and grocery delivery marketplace built on **Supabase (PostgreSQL 17 + Auth + RLS + Storage + Realtime, project `dwsoochnfxldfvcaijie`)**, **Node.js / TypeScript (`/v1` HTTP API + Transactional Outbox Worker + 3 Next.js App Router Web Portals)**, **Native Android (`Kotlin + Jetpack Compose`)**, and **Native iOS (`Swift + SwiftUI`)**.

---

## 1. Core Architectural Invariants & Engineering Standards

- **Zero Mocked Runtime Data:** All backend routes (`apps/api`), background workers (`apps/worker`), and SSR web portals (`customer-web`, `partner-web`, `admin-web`) read and write directly to the real Supabase PostgreSQL database (`dwsoochnfxldfvcaijie`). In-memory mock `Map` databases and silent fallback UUIDs/addresses are prohibited and blocked by `scripts/security-and-hardcode-scan.mjs`.
- **Default Language (`i18n`):** English (`en`) by default across all Web, Mobile, and API surfaces, switchable at any time to Brazilian Portuguese (`pt-BR`) with user preference persisted in Supabase (`public.profiles.preferred_locale` and `public.user_preferences.locale`).
- **Fixed Monetary & Temporal Standards:**
  - **Currency:** Brazilian Real (`BRL`) stored and calculated exclusively in integer centavos (`*_cents`). Switching UI language between `en` and `pt-BR` never changes the currency or monetary amounts.
  - **Timezone:** `UTC` in database/API (`timestamptz`), evaluated and displayed in `America/Sao_Paulo`.
- **Defense-in-Depth Multi-Tenant Security (`M02`, `M03`, `M23`):**
  - **100% of `public` tables (`59 / 59` tables)** enforce PostgreSQL Row Level Security (`rowsecurity = true`) and are populated with `>= 1` record (`is_test_data = true` for synthetic seed records).
  - **13 / 13 Supabase Storage buckets** enforce MIME allowlists, maximum file sizes, anti-path-traversal, and `storage.objects` RLS policies.
  - **17 Segregated Roles:** `anon`, `customer`, `courier`, 7 partner roles (`partner_owner`, `partner_manager`, `partner_operator`, `partner_catalog`, `partner_finance`, `partner_marketing`, `partner_support`), and internal staff roles (`support_l1`, `support_l2`, `operations`, `logistics`, `finance`, `commercial`, `growth_marketing`, `risk_compliance`, `auditor_privacy`, `tech_admin`).
  - **MFA Step-Up (`aal2`) & 4-Eyes Segregation of Duties:** Required for administrative governance, financial ledger access, refunds above the automatic threshold (`> 1500` centavos), settlement payouts, bank account change requests, risk alert reviews, and `/v1/metrics`.
- **Immutable Double-Entry Financial Ledger (`M13`):**
  - `public.ledger_journals` and append-only `public.ledger_entries` enforce balanced debits and credits (`SUM(DEBIT) == SUM(CREDIT)`) via a deferred PostgreSQL constraint trigger (`trg_verify_journal_balanced`).

---

## 2. Repository Structure

```text
.
├── apps/
│   ├── api/                # Versioned /v1 HTTP API server connected to Supabase PostgreSQL
│   ├── worker/             # Transactional outbox worker with exponential backoff & DEAD_LETTER
│   ├── customer-web/       # Consumer marketplace discovery, checkout & PWA (11 App Router routes)
│   ├── partner-web/        # Merchant operations, catalog, KDS, multi-unit & M22 picking (13 routes)
│   ├── admin-web/          # Central Admin, Finance/Ledger, Logistics, Support, Commercial, Marketing & Governance
│   ├── customer-android/   # Native Android Consumer App (Kotlin + Jetpack Compose + Material 3)
│   ├── courier-android/    # Native Android Courier App (Kotlin + Jetpack Compose + Material 3)
│   ├── customer-ios/       # Native iOS Consumer App (Swift 5.10 + SwiftUI)
│   └── courier-ios/        # Native iOS Courier App (Swift 5.10 + SwiftUI)
├── packages/
│   ├── contracts/          # OpenAPI 3.1 (/v1), TypeScript contracts, BRL centavos & i18n catalogs
│   ├── config/             # Env validation, CSP/HSTS/CORS/CSRF headers, rate limiter, anti-SSRF & redactor
│   ├── domain/             # Order/Payment/Delivery state machines, quote/split/scale math & LGPD rules
│   ├── authz/              # RBAC/ABAC policy engine, MFA aal2 verifier & SHA-256 single-use invitations
│   ├── i18n/               # Bilingual en / pt-BR translation engine, BRL & America/Sao_Paulo formatters
│   ├── observability/      # Correlation ID guard, latency percentiles (p50/p95/p99), /v1/metrics & alerts
│   ├── api-client/         # Typed /v1 HTTP client with X-Correlation-Id & X-Idempotency-Key propagation
│   └── ui-web/             # Accessible WCAG 2.1 AA UI state descriptors & language selector view-models
├── supabase/
│   ├── config.toml         # Supabase project configuration (dwsoochnfxldfvcaijie)
│   ├── migrations/         # 15 ordered SQL migrations (M01–M22 schema, RLS, triggers, views, storage)
│   ├── seed.sql            # 100% idempotent synthetic development/test seed (59 tables, is_test_data = true)
│   └── tests/              # Automated 27-invariant SQL RLS, multi-tenant & constraint verification suite
├── tests/
│   └── e2e/                # 4 End-to-End (E2E), concurrency, idempotency & WCAG 2.1 AA test suites
├── scripts/
│   ├── db-apply-migrations.mjs       # Migration, idempotent seed, 27-invariant RLS & empty-table verifier
│   ├── unit-coverage-verify.mjs      # >= 80% unit test coverage gate (Lines, Branches, Functions)
│   ├── security-and-hardcode-scan.mjs# Zero-mock, anti-hardcode & secret leakage static scanner
│   ├── secret-scan.mjs               # Repository secret & .env file scanner
│   ├── db-reset-local.mjs            # Local-only database reset guard (blocks remote hosts)
│   └── bootstrap-first-admin.mjs     # Controlled local bootstrap for initial tech_admin
└── docs/
    ├── PRD.md                        # Product Requirements Document & master scope
    ├── DELIVERY_STATUS.md            # Complete delivery status across M00–M26
    ├── RELEASE_CHECKLIST.md          # Pre-release verification gates & evidence checklist
    ├── architecture/                 # ADR-001 through ADR-008 & conventions.md
    ├── database/                     # ERD.md, DATA_DICTIONARY.md (59 tables), RLS_MATRIX.md
    ├── modules/                      # Individual technical documentation for M00.md through M26.md
    ├── manuals/                      # 4 operational manuals (Customer, Partner/KDS, Courier, Admin)
    ├── ops/                          # Deploy/Rollback, Backup/Restore (RPO/RTO & DR Drill), Observability
    ├── qa/                           # Complete QA Test Matrix (test-matrix.md)
    └── security/                     # STRIDE Threat Model, OWASP Checklist & Secret Rotation Runbook
```

---

## 3. Local Setup, Database Verification & Execution Commands

### 3.1 Prerequisites & Environment Variables
1. **Node.js `>= 22.0.0`** and **`pnpm 10.x`**.
2. Copy `.env.example` to `.env` (never committed to Git) and configure `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_JWT_SECRET` for Supabase project `dwsoochnfxldfvcaijie`.

### 3.2 Install, Build & Database Migration/Seed Verification
```bash
# 1. Install all workspace dependencies
pnpm install

# 2. Apply migrations, execute idempotent seed.sql, run 27 SQL RLS invariants & verify 59/59 non-empty tables
node scripts/db-apply-migrations.mjs --seed --test --check-empty

# 3. Run security, anti-hardcode, and secret leakage scanners
pnpm security:scan
pnpm secret-scan

# 4. Run TypeScript typecheck, lint, and full build across all 14 workspace projects
pnpm lint
pnpm typecheck
pnpm build
```

### 3.3 Running the Automated Test Pyramid (`M24`)
```bash
# 1. Unit Test Coverage Gate (>= 80% Lines, Branches, Functions across packages + mobile test verification)
pnpm test:unit:coverage

# 2. Live Supabase API Contract & Integration Suite (43 tests across 11 suites)
pnpm --filter @ideliveryfood/api test

# 3. End-to-End (E2E) Order Lifecycle, Concurrency, Idempotency & WCAG 2.1 AA Suite (11 tests across 4 suites)
pnpm test:e2e

# 4. Run all workspace package and portal tests
pnpm test
```

---

## 4. Complete Documentation Map (`M26`)

- **Product & Release Governance:**
  - [Product Requirements Document (PRD)](file:///h:/IAProjects/iDeliveryFood/docs/PRD.md)
  - [Delivery Status Report (`M00`–`M26`)](file:///h:/IAProjects/iDeliveryFood/docs/DELIVERY_STATUS.md)
  - [Release Verification Checklist](file:///h:/IAProjects/iDeliveryFood/docs/RELEASE_CHECKLIST.md)
  - [OpenAPI 3.1 Specification (`/v1`)](file:///h:/IAProjects/iDeliveryFood/packages/contracts/openapi/v1.yaml)
- **Database & Multi-Tenant Security:**
  - [Entity-Relationship Diagram (`ERD.md`)](file:///h:/IAProjects/iDeliveryFood/docs/database/ERD.md)
  - [Data Dictionary (`DATA_DICTIONARY.md` — 59 Tables, 4 Views, 13 Buckets)](file:///h:/IAProjects/iDeliveryFood/docs/database/DATA_DICTIONARY.md)
  - [Row Level Security Matrix (`RLS_MATRIX.md` — 59 Tables × 17 Roles)](file:///h:/IAProjects/iDeliveryFood/docs/database/RLS_MATRIX.md)
- **Architecture Decision Records (`docs/architecture/`):**
  - [ADR-001: Reference Architecture, Stack & Monorepo Boundaries](file:///h:/IAProjects/iDeliveryFood/docs/architecture/ADR-001-stack-and-monorepo.md)
  - [ADR-002: Multi-Tenant Authorization, Supabase Auth & RLS](file:///h:/IAProjects/iDeliveryFood/docs/architecture/ADR-002-multi-tenant-authz-rls.md)
  - [ADR-003: Fulfillment Modalities, Commercial Policies & External Providers](file:///h:/IAProjects/iDeliveryFood/docs/architecture/ADR-003-external-providers-and-policies.md)
  - [ADR-004: Order State Machines, Double-Entry Ledger & 4-Eyes Financial Controls](file:///h:/IAProjects/iDeliveryFood/docs/architecture/ADR-004-double-entry-ledger-and-financial-controls.md)
  - [ADR-005: Transactional Outbox, Bilingual Templates & Realtime Cursor Recovery](file:///h:/IAProjects/iDeliveryFood/docs/architecture/ADR-005-transactional-outbox-and-multichannel-notifications.md)
  - [ADR-006: Logistics Address Privacy, Single-Courier Lock, OTP & Fleet Governance](file:///h:/IAProjects/iDeliveryFood/docs/architecture/ADR-006-logistics-privacy-otp-and-fleet-governance.md)
  - [ADR-007: Grocery Picking, Scale Weighing (`HALF_UP`) & Substitutions](file:///h:/IAProjects/iDeliveryFood/docs/architecture/ADR-007-grocery-picking-scale-weighing-and-substitutions.md)
  - [ADR-008: Cybersecurity Hardening, Explainable Risk, LGPD & `/v1/metrics`](file:///h:/IAProjects/iDeliveryFood/docs/architecture/ADR-008-cybersecurity-hardening-explainable-risk-and-lgpd.md)
- **User & Operations Manuals (`docs/manuals/`):**
  - [Customer Web/PWA & Native Mobile Manual](file:///h:/IAProjects/iDeliveryFood/docs/manuals/customer-web-and-mobile-manual.md)
  - [Partner Portal, Catalog, KDS, Multi-Unit & Grocery Picking Manual](file:///h:/IAProjects/iDeliveryFood/docs/manuals/partner-portal-and-kds-manual.md)
  - [Courier Native Mobile (Android & iOS) Manual](file:///h:/IAProjects/iDeliveryFood/docs/manuals/courier-mobile-manual.md)
  - [Admin, Finance, Logistics, Support, Commercial, Marketing & Governance Manual](file:///h:/IAProjects/iDeliveryFood/docs/manuals/admin-backoffice-manual.md)
- **Security, QA & DevOps Runbooks:**
  - [QA Test & Traceability Matrix (`M00`–`M26`)](file:///h:/IAProjects/iDeliveryFood/docs/qa/test-matrix.md)
  - [STRIDE Threat Model](file:///h:/IAProjects/iDeliveryFood/docs/security/threat-model-stride.md) · [OWASP Verification Checklist](file:///h:/IAProjects/iDeliveryFood/docs/security/owasp-verification-checklist.md) · [Secret Rotation & Incident Runbook](file:///h:/IAProjects/iDeliveryFood/docs/security/secret-rotation-and-incident-runbook.md)
  - [Deploy & Rollback Runbook](file:///h:/IAProjects/iDeliveryFood/docs/ops/deploy-and-rollback-runbook.md) · [Backup, Restore & DR Drill (`RPO`/`RTO`)](file:///h:/IAProjects/iDeliveryFood/docs/ops/backup-restore-and-dr-drill.md) · [Observability & Alerts Runbook](file:///h:/IAProjects/iDeliveryFood/docs/ops/observability-and-alerts.md)
- **Module Reference (`M00`–`M26`):** See [`docs/modules/M00.md`](file:///h:/IAProjects/iDeliveryFood/docs/modules/M00.md) through [`docs/modules/M26.md`](file:///h:/IAProjects/iDeliveryFood/docs/modules/M26.md).
