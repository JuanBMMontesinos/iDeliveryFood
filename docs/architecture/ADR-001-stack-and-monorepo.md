# ADR-001: Reference Architecture, Technology Stack, and Monorepo Boundaries

- **Status:** Approved
- **Date:** 2026-11-03 (Updated 2026-11-21)
- **Module:** `M00` / `M01` / `M26`

## Context
**iDeliveryFood** requires three web portals (`customer-web` PWA, `partner-web`, `admin-web`), a shared transactional backend API (`apps/api`) and asynchronous outbox worker (`apps/worker`), and four independent native mobile applications for Android and iOS (`customer-android`, `courier-android`, `customer-ios`, `courier-ios`) with zero hybrid/webview wrappers, zero mocked in-memory persistence, and 100% bilingual parity (`en` default, `pt-BR` selectable).

## Decision
1. **Workspace & Backend/Web Stack (`pnpm-workspace.yaml` — 14 TypeScript Projects):**
   - **Backend API (`@ideliveryfood/api`, `apps/api`):** Node.js/TypeScript HTTP server exposing versioned `/v1` REST endpoints documented via OpenAPI 3.1 (`packages/contracts/openapi/v1.yaml`) and connected directly to Supabase PostgreSQL (`dwsoochnfxldfvcaijie`).
   - **Async Outbox Worker (`@ideliveryfood/worker`, `apps/worker`):** Node.js/TypeScript worker polling `public.outbox_events` with idempotency, exponential backoff (`1s`..`60s`), and `DEAD_LETTER` transition.
   - **Web Portals (`apps/customer-web`, `apps/partner-web`, `apps/admin-web`):** Next.js App Router (TypeScript) consuming `@ideliveryfood/api-client`, `@ideliveryfood/contracts`, `@ideliveryfood/i18n`, and `@ideliveryfood/ui-web`.

2. **Shared Packages (8 Core Packages under `packages/`):**
   - `@ideliveryfood/contracts`: OpenAPI 3.1 specification, TypeScript domain/API contracts, integer BRL centavo helpers, `America/Sao_Paulo` timezone constants, and bilingual message catalogs (`en` and `pt-BR`).
   - `@ideliveryfood/domain`: Pure domain state machines (`OrderStatus`, `PaymentStatus`, `DeliveryStatus`), integer centavo quote/split/refund/scale-weighing calculators, and external provider adapter contracts.
   - `@ideliveryfood/authz`: RBAC/ABAC policy engine, organization/store tenant scope guards, MFA (`aal2`) step-up enforcement, single-use invitation validation, and `user_metadata` sanitization.
   - `@ideliveryfood/api-client`: Typed `/v1` HTTP client propagating `X-Correlation-Id`, `X-Idempotency-Key`, `Accept-Language`, and `Authorization`.
   - `@ideliveryfood/ui-web`: Accessible WCAG 2.1 AA UI state descriptors (`loading`, `empty`, `error`, `offline`, `forbidden`) with `role="status"|"alert"` and `aria-live="polite"|"assertive"`, plus language selector view models.
   - `@ideliveryfood/i18n`: Bilingual localization engine (`en` default, `pt-BR` selectable), currency formatter (`BRL`), and `America/Sao_Paulo` date/time formatter.
   - `@ideliveryfood/config`: Environment variable loader separating server-only secrets from public client config, HTTP security headers (CSP, HSTS, CORS, CSRF), sliding-window rate limiter, anti-mass-assignment, anti-SSRF, and recursive PII/secret redactor.
   - `@ideliveryfood/observability`: Correlation ID sanitizer, latency percentile calculator (`p50`/`p95`/`p99`), `/v1/metrics` runtime collector, SLI/SLO alert evaluator, and Prometheus text exporter.

3. **Native Mobile Applications (4 Independent Native Apps):**
   - **Android (`apps/customer-android`, `apps/courier-android`):** Native Kotlin + Jetpack Compose managed by Gradle. Uses `res/values/strings.xml` (`en` default) and `res/values-pt-rBR/strings.xml` (`pt-BR`) with 100% key parity (53 keys each), Android Keystore / EncryptedSharedPreferences for token storage, and `contentDescription` accessibility semantics.
   - **iOS (`apps/customer-ios`, `apps/courier-ios`):** Native Swift + SwiftUI managed by Swift Package Manager (`Package.swift`). Uses `Resources/en.lproj/Localizable.strings` (`en` default) and `Resources/pt-BR.lproj/Localizable.strings` (`pt-BR`) with 100% key parity (53 keys each), iOS Keychain (`kSecClassGenericPassword`) for token storage, and `.accessibilityLabel` semantics.
   - **No Hybrid Frameworks:** React Native, Expo, Flutter, Ionic, Capacitor, and WebView wrappers are strictly prohibited.

## Consequences
- All business logic and privileged mutations execute in `apps/api` and PostgreSQL/Supabase (`dwsoochnfxldfvcaijie`).
- Contract changes are versioned in `packages/contracts` and verified across Web, Android, and iOS test suites.
