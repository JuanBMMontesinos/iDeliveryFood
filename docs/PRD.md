# iDeliveryFood — Product Requirements Document (PRD) & Master Scope

## 1. Executive Vision & Core Boundaries
**iDeliveryFood** is a multi-tenant food delivery marketplace platform connecting consumers, partner restaurants/merchants, independent couriers, and internal platform operations.

- **Core Product (Enabled by Default):** Restaurant & prepared food marketplace with hybrid fulfillment (`PLATFORM_DELIVERY`, `MERCHANT_DELIVERY`, `PICKUP`), server-side pricing/quoting in integer BRL cents, double-entry financial ledger, strict tenant isolation, and bilingual (`en` default, `pt-BR` switchable & persisted) interfaces across Web and Native Mobile (Android Kotlin/Compose, iOS Swift/SwiftUI).
- **Conditioned Extensions (Disabled by Default via Feature Flags until Contract/Legal Approval):**
  - **M15 — Fleet & Logistics Operators Portal:** Disabled by default (`feature_fleet_operators_enabled = false`).
  - **M22 — Grocery / Supermarket Picking & Substitutions:** Disabled by default (`feature_grocery_picking_enabled = false`).
  - **Sponsored Ads & Subscriptions (M19):** Disabled by default (`feature_sponsored_ads_enabled = false`, `feature_subscriptions_enabled = false`).

---

## 2. Applications, Portals & Actors Matrix

| Surface / App | Path | Stack | Primary Actors | Scope & Isolation |
|---|---|---|---|---|
| **Customer Web / PWA** | `apps/customer-web` | Next.js (TypeScript) | Consumer (`customer`), Guest (`anon` catalog browse only) | Own profile, addresses, quotes, orders, reviews, support cases |
| **Customer Android** | `apps/customer-android` | Kotlin + Jetpack Compose | Consumer (`customer`) | Native mobile; Keystore/EncryptedSharedPreferences; own customer scope |
| **Customer iOS** | `apps/customer-ios` | Swift + SwiftUI | Consumer (`customer`) | Native mobile; Keychain; String Catalog (`en`/`pt-BR`); own customer scope |
| **Courier Android** | `apps/courier-android` | Kotlin + Jetpack Compose | Courier (`courier`) | Native mobile; own profile/vehicle/availability, eligible offers, active assignment, own earnings |
| **Courier iOS** | `apps/courier-ios` | Swift + SwiftUI | Courier (`courier`) | Native mobile; Keychain; String Catalog (`en`/`pt-BR`); own courier scope |
| **Partner Web Portal** | `apps/partner-web` | Next.js (TypeScript) | `partner_owner`, `partner_manager`, `partner_operator`, `partner_finance` | Scoped strictly to `organization_id` and authorized `store_id` units; includes Store Management (M07), Order Manager Console (M08), Multi-Unit/Chain Portal (M09), and Conditioned Grocery Picking (M22) |
| **Central Admin Web** | `apps/admin-web` | Next.js (TypeScript) | `operations`, `logistics`, `support`, `finance`, `commercial`, `marketing`, `risk_compliance`, `auditor_privacy`, `tech_admin` | Role-segregated backoffice areas (M13 Finance, M14 Logistics/Dispatch, M15 Fleet, M16 Central Admin, M17 Support, M18 Commercial, M19 Marketing, M21 BI/Risk/Privacy). Mandatory MFA (`aal2`) for privileged staff |
| **Backend API** | `apps/api` | NestJS (TypeScript) | All client apps via `/v1` | Single shared backend enforcing server-side AuthZ, validation, quoting, state machines, and audit logging |
| **Async Worker** | `apps/worker` | Node.js / TypeScript | Transactional Outbox & Queues | Idempotent event dispatching, notifications (M20), reconciliation jobs, retention enforcement |

---

## 3. Phase Execution Roadmap

- **Phase A (Foundation, Data, Security & Identity):**
  - `M00`: Audit, PRD, ADRs, conventions, OpenAPI `/v1` contracts, i18n parity contract.
  - `M01`: Monorepo (`pnpm`), native mobile projects, strict `.env` separation, redacted logger, real `/v1/health` & provider readiness endpoints.
  - `M02`: Supabase (`dwsoochnfxldfvcaijie`) schema, versioned migrations, strict RLS & grants, Storage buckets, idempotent `supabase/seed.sql` executed remotely, pgTAP/SQL RLS verification.
  - `M03`: Identity, accounts, RBAC/ABAC permissions, team invitations, MFA step-up (`aal2`), session/device revocation, LGPD export/deletion requests with retention checks.
- **Phase B (Catalog & Transactional Core):**
  - `M04`: Stores, catalog, operating hours, geographic coverage, server-side quoting.
  - `M10`: Cart/quote conversion, immutable order snapshots, separated Order/Payment/Delivery state machines, transactional outbox.
- **Phase C (Core Interfaces & Operations):**
  - `M16`: Central admin backoffice & RBAC management.
  - `M07`, `M05`, `M06`, `M08`: Partner management portal, Customer Web/PWA, Customer Native Mobile (Android/iOS), Partner Order Operations Console.
- **Phase D (Payments, Finance & Logistics):**
  - `M12` -> `M13`: PSP integration, signed webhooks, refunds, double-entry ledger, reconciliation.
  - `M14` -> `M11`: Logistics dispatch console & Courier Native Mobile (Android/iOS).
- **Phase E (Support, Commercial, Marketing, Notifications, Governance & Release):**
  - `M17`, `M18`, `M19`, `M20`, `M21`, plus conditioned `M09`, `M15`, `M22`, and release gates `M23` (Cybersecurity/ASVS), `M24` (QA/E2E), `M25` (DevOps/DR), `M26` (Final Docs & Release).

---

## 4. Integration Inventory & Approved Decisions

| Domain | Approved Decision (Owner Confirmed) | Pre-Configured Future Adapters | Runtime Behavior When Unconfigured |
|---|---|---|---|
| **Database, Auth, Storage, Realtime** | Supabase project `dwsoochnfxldfvcaijie` (`us-east-1`, dev/test environment confirmed) | Local Supabase CLI + Remote MCP | Active & connected; verified via migrations and seed |
| **Fulfillment Model** | Hybrid (`PLATFORM_DELIVERY`, `MERCHANT_DELIVERY`, `PICKUP`) | Configurable per store (`store_delivery_policies`) | Active via database-backed rules |
| **Commercial & Fee Policies** | Stored in `platform_policies` & `commission_rule_versions` (integer cents & basis points) | Versioned per merchant contract | Active via database-backed rules |
| **Payment Service Provider (PSP - M12)** | Adapter architecture with webhook signature & replay verification | `stripe`, `mercadopago`, `pagarme` | Returns honest `PROVIDER_NOT_CONFIGURED` (`503` / `BLOQUEADO`), never fake payment success |
| **Maps & Geocoding (M04 / M14)** | PostGIS / Haversine radius & polygon coverage in DB + External Routing Adapter | `google_maps`, `mapbox` | Radius/polygon coverage works in DB; external route ETA reports `BLOQUEADO` if API key absent |
| **Messaging & Push (M20)** | Transactional Outbox (`outbox_events`) + In-App Notifications | `resend` (Email), `fcm` (Android Push), `apns` (iOS Push) | In-app notifications work via DB; external push/email reports `BLOQUEADO` if credentials absent |
| **Apple / Xcode Build Runner** | Native Swift/SwiftUI source in `apps/customer-ios` & `apps/courier-ios` | GitHub Actions macOS Xcode runner | Marked `BLOQUEADO` on Windows local host; validated on macOS CI runner |
