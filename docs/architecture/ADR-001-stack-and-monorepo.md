# ADR-001: Reference Architecture, Technology Stack, and Monorepo Boundaries

- **Status:** Approved
- **Date:** 2026-11-03
- **Module:** M00 / M01

## Context
iDeliveryFood requires multiple web portals (Customer Web/PWA, Partner Web, Admin Web), a shared transactional backend API and asynchronous worker, and independent native mobile applications for Android and iOS (Customer and Courier) with zero hybrid/webview wrappers and zero hardcoded business data.

## Decision
1. **Workspace & Backend/Web Stack:**
   - Managed via `pnpm` workspaces (`pnpm-workspace.yaml`).
   - **Backend API (`apps/api`):** NestJS (TypeScript) exposing versioned `/v1` REST endpoints documented via OpenAPI 3.1 (`packages/contracts/openapi/v1.yaml`).
   - **Async Worker (`apps/worker`):** Node.js/TypeScript service polling transactional outbox (`outbox_events`) with idempotency, exponential backoff, and dead-letter handling.
   - **Web Portals (`apps/customer-web`, `apps/partner-web`, `apps/admin-web`):** Next.js App Router (TypeScript), consuming `@idelivery/api-client`, `@idelivery/contracts`, and `@idelivery/ui-web`.

2. **Shared Packages (Backend & Web Only):**
   - `packages/contracts`: OpenAPI 3.1 specification, Zod validation schemas, DTOs, error envelopes, pagination types, and i18n message catalogs (`en` and `pt-BR`) with key parity validation.
   - `packages/domain`: Pure domain state machines (Order, Payment, Delivery), integer centavos money calculations, quote/fee/cancellation rules, and external provider adapter contracts (Stripe, Mercado Pago, Pagar.me, Google Maps, Mapbox, Resend, FCM, APNs).
   - `packages/authz`: RBAC/ABAC policy engine, tenant/organization/unit scope guards, MFA (`aal2`) enforcement, and `user_metadata` sanitization.
   - `packages/api-client`: Typed HTTP client for `/v1` API with correlation IDs, idempotency keys, and locale headers.
   - `packages/ui-web`: Accessible React components, i18n context (`en` default, `pt-BR` switchable), loading/empty/error/offline/forbidden state views, and locale-aware formatters.
   - `packages/config`: Strict Zod environment variable loaders (separating server-only secrets from public client config) and redacted structured JSON logger.

3. **Native Mobile Applications (Strictly Separated):**
   - **Android (`apps/customer-android`, `apps/courier-android`):** Native Kotlin + Jetpack Compose managed by Gradle. Uses Android `strings.xml` (`values/strings.xml` for `en` default and `values-pt-rBR/strings.xml` for `pt-BR`), Android Keystore / EncryptedSharedPreferences for token storage, and native Kotlin HTTP/domain layers.
   - **iOS (`apps/customer-ios`, `apps/courier-ios`):** Native Swift + SwiftUI managed by Xcode / Swift Package Manager. Uses `Localizable.xcstrings` String Catalog (`en` default and `pt-BR`), iOS Keychain for token storage, and native Swift HTTP/domain layers.
   - **No Hybrid Frameworks:** React Native, Expo, Flutter, Ionic, Capacitor, and WebView wrappers are strictly prohibited.

## Consequences
- Business logic and privileged writes execute exclusively in `apps/api` and PostgreSQL/Supabase.
- Contract changes are versioned in `packages/contracts` and reflected across Web, Android, and iOS clients.
- On non-macOS hosts (such as Windows), iOS source code and tests are maintained in the repository and CI configuration, while local iOS compilation is transparently reported as `BLOQUEADO (requires macOS/Xcode runner)`.
