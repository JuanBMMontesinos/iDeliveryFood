# iDeliveryFood — Release Verification Checklist (`M23`, `M24`, `M25`, `M26`)

## 1. Pre-Release Gate Summary

| # | Gate Category | Verification Command | Target Threshold | Verified Result | Status |
| :---: | :--- | :--- | :--- | :--- | :---: |
| 1 | **Secret & `.env` Leakage Scan** | `pnpm secret-scan` | `0` secrets / `.env` files | `[SECRET SCAN PASSED] 0 forbidden secrets or .env files detected.` | **PASS** |
| 2 | **Zero-Mock & Anti-Hardcode Scan** | `pnpm security:scan` | `0` in-memory DB Maps / fallbacks | `[SECURITY & HARDCODE SCAN PASSED] 0 secret leaks, 0 .env files, 0 in-memory DB Maps` | **PASS** |
| 3 | **TypeScript Typecheck & Lint (14 Projects)** | `pnpm lint && pnpm typecheck` | `0` errors / warnings | `13/13` TS packages & apps typechecked cleanly (`0` errors) | **PASS** |
| 4 | **Full Workspace Build** | `pnpm build` | `0` build errors | All packages, `apps/api`, `apps/worker`, and 3 Next.js portals built | **PASS** |
| 5 | **Supabase Migrations, Idempotent Seed & 59 Non-Empty Tables** | `node scripts/db-apply-migrations.mjs --seed --test --check-empty` | `59/59` RLS tables with `>= 1` row | `[NON-EMPTY CHECK OK] All 59 public tables have >= 1 row in Supabase.` | **PASS** |
| 6 | **27 SQL RLS, Multi-Tenant & Ledger Invariants** | `node scripts/db-apply-migrations.mjs --test` | `27/27` invariants passing | `ALL_27_SECURITY_RLS_STORAGE_AND_M00_TO_M22_INVARIANTS_PASSED` | **PASS** |
| 7 | **Unit Test Coverage Gate (`M24`)** | `pnpm test:unit:coverage` | `>= 80%` Lines, Branches, Functions | **Line: `97.04%` \| Branch: `87.88%` \| Funcs: `99.31%`** + 16 mobile suites | **PASS** |
| 8 | **Live Supabase `/v1` API Integration Suite** | `pnpm --filter @ideliveryfood/api test` | `100%` passing (`0` failures) | **`43 / 43` tests passing across 11 suites** against `dwsoochnfxldfvcaijie` | **PASS** |
| 9 | **End-to-End (E2E), Concurrency, Idempotency & WCAG 2.1 AA Suite** | `pnpm test:e2e` | `100%` passing (`0` failures) | **`11 / 11` E2E tests passing across 4 suites** (`journey1`..`journey4`) | **PASS** |
| 10 | **Complete Documentation & OpenAPI 3.1 Contract (`M26`)** | Verified by `integration.test.ts` & file audit | `M00`–`M26`, `ADR-001`–`008`, 4 manuals, 3 ops runbooks, 3 security docs | All 27 module docs, 8 ADRs, 4 manuals, ERD/Dictionary/RLS Matrix present | **PASS** |

---

## 2. Database & Financial Integrity Checklist (`dwsoochnfxldfvcaijie`)

- [x] **100% RLS Coverage:** `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false` returns **`0`** (`59/59` protected).
- [x] **Zero Empty Public Tables:** Every single table in `public` (`59/59`) contains `>= 1` valid record.
- [x] **Idempotent Seed Verification:** Executing `supabase/seed.sql` multiple consecutive times produces zero duplicate rows and keeps all row counts and ledger balances invariant.
- [x] **Double-Entry Financial Balance (`M13`):** `SUM(DEBIT) == SUM(CREDIT)` across all journals in `public.ledger_entries` (`isLedgerBalanced: true`).
- [x] **13 Hardened Storage Buckets:** All 13 buckets enforce explicit `file_size_limit`, `allowed_mime_types` (no `.svg`/`.html`/`.js`), and `storage.objects` RLS policies.

---

## 3. Git & GitHub Publication Checklist

- [x] `.gitignore` excludes `node_modules/`, `dist/`, `.next/`, `build/`, `.gradle/`, `.env`, `.env.*` (except `.env.example`), and local PDF planning artifacts.
- [x] Working tree and Git commit history verified free of secrets by `scripts/secret-scan.mjs`.
- [x] Remote `origin` configured as `https://github.com/JuanBMMontesinos/iDeliveryFood.git` and synchronized on branch `main`.

---

## 4. Fase $\gamma$ (GAMA) — Full Monorepo Quality Battery Execution Log

| Step | Command Executed | Exit Code | Evidence Summary |
| :---: | :--- | :---: | :--- |
| 1 | `pnpm install --frozen-lockfile` | `0` | `Lockfile is up to date, resolution step is skipped. Already up to date (14 workspace projects).` |
| 2 | `pnpm lint` | `0` | `[SECRET SCAN PASSED]` + `13/13` TypeScript projects linted with `0` warnings/errors. |
| 3 | `pnpm typecheck` | `0` | `13/13` TypeScript projects (`packages/*`, `apps/api`, `apps/worker`, `customer-web`, `partner-web`, `admin-web`) passed `tsc --noEmit`. |
| 4 | `pnpm build` | `0` | Full build completed across all workspace packages and applications. |
| 5 | `node scripts/unit-coverage-verify.mjs` | `0` | `GLOBAL AGGREGATE: Line 97.04% | Branch 87.88% | Funcs 99.31%` (threshold `>= 80.0%`) + `32/32` web/worker tests + `16/16` native mobile test suites. |
| 6 | `pnpm --filter @ideliveryfood/api test` | `0` | `43 / 43` unit & live Supabase integration tests passing across `11` suites (`0` failures). |
| 7 | `pnpm test:e2e` | `0` | `11 / 11` E2E order lifecycle, support/refund 4-eyes, concurrency/idempotency & WCAG 2.1 AA tests passing across `4` suites (`0` failures). |
| 8 | `node scripts/verify-double-seed-idempotency.mjs` | `0` | `59/59` RLS tables non-empty, `0` drift across consecutive `seed.sql` runs, balanced ledger (`70532c == 70532c`), `27/27` SQL RLS invariants passed. |
| 9 | `pnpm secret-scan && pnpm security:scan` | `0` | `0` secret leaks, `0` `.env` files tracked, `0` in-memory mock DB Maps, `0` hardcoded UUID/address fallbacks. |
